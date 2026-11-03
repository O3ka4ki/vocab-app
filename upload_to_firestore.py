# -*- coding: utf-8 -*-
import csv
import json
import time
import urllib.request

API_KEY = "AIzaSyAsRk1IwwhaUIvxY2S6n7M6NkDX4szf5jg"
PROJECT_ID = "vocab-app-e76ce"
CSV_PATH = "samples/sample_words.csv"

def upload_all_words():
    words = []
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader, None)
        idx = 1
        for row in reader:
            if not row or len(row) < 2:
                continue
            word_str = row[0].strip()
            meaning_str = row[1].strip()
            if not word_str or not meaning_str:
                continue

            phonetic_str = row[2].strip() if len(row) > 2 else ""
            example_str = row[3].strip() if len(row) > 3 else ""
            category_str = row[4].strip() if len(row) > 4 else "General"

            words.append({
                "id": idx,
                "word": word_str,
                "meaning": meaning_str,
                "phonetic": phonetic_str,
                "example": example_str,
                "category": category_str,
                "status": "unseen",
                "updatedAt": int(time.time() * 1000)
            })
            idx += 1

    print(f"Loaded {len(words)} words from CSV.")

    commit_url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents:commit?key={API_KEY}"
    batch_size = 400

    for i in range(0, len(words), batch_size):
        chunk = words[i:i + batch_size]
        writes = []

        for w in chunk:
            doc_path = f"projects/{PROJECT_ID}/databases/(default)/documents/words/word_{w['id']}"
            writes.append({
                "update": {
                    "name": doc_path,
                    "fields": {
                        "id": {"integerValue": str(w["id"])},
                        "word": {"stringValue": w["word"]},
                        "meaning": {"stringValue": w["meaning"]},
                        "phonetic": {"stringValue": w["phonetic"]},
                        "example": {"stringValue": w["example"]},
                        "category": {"stringValue": w["category"]},
                        "status": {"stringValue": w["status"]},
                        "updatedAt": {"integerValue": str(w["updatedAt"])}
                    }
                }
            })

        req = urllib.request.Request(
            commit_url,
            data=json.dumps({"writes": writes}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        with urllib.request.urlopen(req) as resp:
            print(f"Uploaded batch {i // batch_size + 1}: {len(chunk)} words.")

    print(f"Successfully uploaded all {len(words)} words to Firestore!")

if __name__ == "__main__":
    upload_all_words()

