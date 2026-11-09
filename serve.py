"""
serve.py — 개발용 로컬 서버 (python -m http.server 와 같지만 브라우저가 파일을 저장해 두지 못하게 함)
사용법: python serve.py [포트]   (기본 8010)   ※ start.bat 이 이 파일을 실행한다.
코드를 고친 뒤 새로고침만 해도 항상 최신 파일이 로딩되도록 Cache-Control 헤더를 붙인다.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8010  # start.bat / README 와 같은 포트
    print(f"서버 시작: http://localhost:{port}  (끄려면 Ctrl+C)")
    ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
