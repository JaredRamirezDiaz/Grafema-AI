import json
import unittest

from app.recommendation import make_messages, parse_recommendations


class RecommendationTests(unittest.TestCase):
    def test_only_retrieved_ids_are_returned_and_duplicates_removed(self):
        raw = '```json\n' + json.dumps({"recommendations": [
            {"id": "inventado", "reason": "Razón fabricada"},
            {"id": "canto-1", "reason": "Habla sobre esperanza durante las dificultades."},
            {"id": "canto-1", "reason": "Otra razón para el mismo canto."},
            {"id": "canto-2", "reason": "Expresa confianza en medio de la tempestad."},
        ]}) + '\n```'
        actual = parse_recommendations(raw, {"canto-1", "canto-2"}, 3)
        self.assertEqual([item["id"] for item in actual], ["canto-1", "canto-2"])

    def test_rejects_output_without_allowed_songs(self):
        with self.assertRaises(ValueError):
            parse_recommendations('{"recommendations":[{"id":"desconocido","reason":"Una razón inventada"}]}', {"canto-1"}, 3)

    def test_prompt_contains_only_the_eight_retrieved_songs(self):
        candidates = [{"id": str(i), "title": f"Canto {i}", "lyrics": "paz y esperanza"} for i in range(10)]
        messages = make_messages("Cantos de paz", candidates, 3)
        context = json.loads(messages[1]["content"])
        self.assertEqual(len(context["candidates"]), 8)
        self.assertEqual(context["query"], "Cantos de paz")


if __name__ == "__main__":
    unittest.main()
