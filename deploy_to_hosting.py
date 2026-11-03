# -*- coding: utf-8 -*-
"""
deploy_to_hosting.py
Node.js や Firebase CLI なしで、Python から直接 Firebase Hosting にデプロイするスクリプト
"""
import os
import gzip
import hashlib
import json
import subprocess
import urllib.request

PROJECT_ID = "vocab-app-e76ce"
SITE_ID = "vocab-app-e76ce"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def get_access_token():
    cmd = ['C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd', 'auth', 'print-access-token']
    return subprocess.check_output(cmd).decode().strip()

def collect_files():
    # デプロイ対象ファイルの収集
    allowed_exts = {'.html', '.js', '.css', '.json', '.csv', '.png', '.jpg', '.jpeg', '.svg', '.ico'}
    files_map = {} # path_str -> (gzipped_bytes, sha256)

    for root, dirs, files in os.walk(BASE_DIR):
        if '.git' in root or '__pycache__' in root or '.system_generated' in root:
            continue
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext not in allowed_exts:
                continue
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, BASE_DIR).replace('\\', '/')
            url_path = '/' + rel_path

            with open(full_path, 'rb') as fp:
                raw_data = fp.read()

            # Firebase Hosting は gzip 圧縮されたコンテンツとその sha256 を要求する
            gzipped_data = gzip.compress(raw_data)
            sha256 = hashlib.sha256(gzipped_data).hexdigest()
            files_map[url_path] = (gzipped_data, sha256)

    return files_map

def deploy():
    print("1. 認証トークン取得中...")
    token = get_access_token()
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
        'X-Goog-User-Project': PROJECT_ID
    }

    print("2. デプロイ対象ファイルの収集中 (gzip圧縮 & ハッシュ計算)...")
    files_map = collect_files()
    print(f"   対象ファイル数: {len(files_map)} 件")

    print("3. 新規 Hosting バージョンの作成中...")
    create_ver_url = f"https://firebasehosting.googleapis.com/v1beta1/sites/{SITE_ID}/versions"
    ver_payload = {
        "config": {
            "headers": [
                {
                    "glob": "**",
                    "headers": {
                        "Cache-Control": "no-cache"
                    }
                }
            ]
        }
    }
    req = urllib.request.Request(create_ver_url, data=json.dumps(ver_payload).encode('utf-8'), headers=headers, method='POST')
    with urllib.request.urlopen(req) as resp:
        ver_data = json.loads(resp.read().decode('utf-8'))
        version_name = ver_data['name']
    print(f"   Version Name: {version_name}")

    print("4. ファイルハッシュの登録中 (populateFiles)...")
    populate_url = f"https://firebasehosting.googleapis.com/v1beta1/{version_name}:populateFiles"
    file_hashes = {path: info[1] for path, info in files_map.items()}
    pop_req = urllib.request.Request(populate_url, data=json.dumps({"files": file_hashes}).encode('utf-8'), headers=headers, method='POST')
    with urllib.request.urlopen(pop_req) as resp:
        pop_res = json.loads(resp.read().decode('utf-8'))
        upload_required = pop_res.get('uploadRequiredHashes', [])
        upload_url = pop_res.get('uploadUrl', '')

    print(f"   新規アップロードが必要なファイル数: {len(upload_required)} 件")

    # 必要なハッシュを持つファイルをアップロード
    hash_to_bytes = {info[1]: info[0] for info in files_map.values()}
    for i, h in enumerate(upload_required):
        file_data = hash_to_bytes[h]
        up_req = urllib.request.Request(
            f"{upload_url}/{h}",
            data=file_data,
            headers={
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/octet-stream',
                'X-Goog-User-Project': PROJECT_ID
            },
            method='POST'
        )
        with urllib.request.urlopen(up_req) as resp:
            pass
        if (i + 1) % 5 == 0 or (i + 1) == len(upload_required):
            print(f"   アップロード進捗: {i + 1} / {len(upload_required)}")

    print("5. バージョンの確定 (FINALIZED)...")
    finalize_url = f"https://firebasehosting.googleapis.com/v1beta1/{version_name}?update_mask=status"
    fin_req = urllib.request.Request(finalize_url, data=json.dumps({"status": "FINALIZED"}).encode('utf-8'), headers=headers, method='PATCH')
    with urllib.request.urlopen(fin_req) as resp:
        pass

    print("6. リリースの作成中...")
    release_url = f"https://firebasehosting.googleapis.com/v1beta1/sites/{SITE_ID}/releases?versionName={version_name}"
    rel_req = urllib.request.Request(release_url, data=b"{}", headers=headers, method='POST')
    with urllib.request.urlopen(rel_req) as resp:
        pass

    print("\n" + "=" * 60)
    print(" [SUCCESS] Deploy complete!")
    print(f" URL: https://{SITE_ID}.web.app")
    print(f" Sub URL: https://{SITE_ID}.firebaseapp.com")
    print("=" * 60)

if __name__ == "__main__":
    deploy()
