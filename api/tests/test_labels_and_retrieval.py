import json
import tempfile
import unittest
from pathlib import Path

from app.recommendation import make_messages
from app.retrieval import infer_intent,rank_songs
from scripts.label_data import LABELS,load_rows,section_text,digest


class ImportTests(unittest.TestCase):
    def test_export_matches_catalog_and_scores_are_complete(self):
        songs,sections,meta=load_rows()
        self.assertEqual((len(songs),len(sections)),(550,2040))
        self.assertEqual(len({(s['song_id'],s['section_index']) for s in sections}),2040)
        self.assertTrue(meta['ontology_version'])
        first=sections[0]
        self.assertEqual(first['content_hash'],digest(first['content']))
        self.assertEqual(first['content'],section_text('A Cristo doy mi canto',{'type':first['section_type'],'order':first['section_order'],'lines':first['lines']}))

    def test_changed_section_fails_before_upload(self):
        data=json.loads(LABELS.read_text(encoding='utf8'))
        data['songs'][0]['sections'][0]['lines'][0]='Letra distinta'
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/'altered.json';file.write_text(json.dumps(data),encoding='utf8')
            with self.assertRaisesRegex(ValueError,'sección cambió'):
                load_rows(file)


class RankingTests(unittest.TestCase):
    def setUp(self):
        self.songs=[{'id':'a','title':'Canto A','artist':None,'lyrics':'estrofas a','similarity':.81,'scores':{'temas':{'segunda_venida':.14}}},
                    {'id':'b','title':'Canto B','artist':None,'lyrics':'estrofas b','similarity':.72,'scores':{'temas':{'segunda_venida':.31}}}]
        self.parts=[{'song_id':'b','title':'Canto B','artist':None,'lyrics':'estrofas b','section_index':2,'section_order':3,'section_type':'verse',
                     'section_text':'Regresa Jesús','similarity':.87,'scores':{'temas':{'segunda_venida':.97},'energia':{'valor':4}},'song_scores':self.songs[1]['scores']}]

    def test_same_song_deduplicated_and_best_part_has_evidence(self):
        baseline,_=rank_songs(self.songs,self.parts,'segunda venida de Cristo','song')
        combined,_=rank_songs(self.songs,self.parts,'segunda venida de Cristo','combined')
        tagged,intent=rank_songs(self.songs,self.parts,'segunda venida de Cristo','labels')
        self.assertEqual(baseline[0]['id'],'a')
        self.assertEqual(combined[0]['id'],'b')
        self.assertEqual(tagged[0]['id'],'b')
        self.assertEqual(tagged[0]['matched_section']['index'],2)
        self.assertEqual(len({r['id'] for r in tagged}),len(tagged))
        self.assertIn('segunda_venida',intent['labels']['temas'])

    def test_untagged_query_does_not_add_boost(self):
        ranked,intent=rank_songs(self.songs,self.parts,'¿Dónde está este himno?','labels')
        self.assertEqual(intent['labels'],{})
        self.assertIsNone(ranked[0]['tag_fit'])
        self.assertEqual(ranked[0]['score'],.87)

    def test_llama_gets_whole_song_and_matching_verse(self):
        ranked,_=rank_songs(self.songs,self.parts,'segunda venida de Cristo','labels')
        context=json.loads(make_messages('segunda venida',ranked,2)[1]['content'])['candidates'][0]
        self.assertEqual(context['matching_section']['text'],'Regresa Jesús')
        self.assertEqual(context['matching_section']['tags']['temas'],['segunda_venida'])


if __name__=='__main__':unittest.main()
