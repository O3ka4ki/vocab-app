# -*- coding: utf-8 -*-
import os
import socket
import webbrowser
import http.server
import socketserver

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def main():
    port = 8080
    local_ip = get_local_ip()
    url_local = f"http://localhost:{port}"
    url_mobile = f"http://{local_ip}:{port}"

    print("=" * 60)
    print("        ⚡ Vocab100 スワイプ学習サーバー起動中 ⚡")
    print("=" * 60)
    print()
    print(f"  💻 PCで開く場合   :  {url_local}")
    print()
    print(f"  📱 スマホで開く場合 :  {url_mobile}")
    print()
    print("  ※ PCとスマホが同じWi-Fi（またはスマホのテザリング）に")
    print("    接続されている必要があります。")
    print("=" * 60)
    print()
    print("サーバーを終了するには、この黒い画面で [Ctrl + C] を押してください。")
    print()

    # 自動でPCブラウザを開く
    webbrowser.open(url_local)

    # サーバー起動
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("", port), handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nサーバーを停止しました。")

if __name__ == "__main__":
    main()
