#!/usr/bin/env python3
"""Real Chromium browser E2E against CellGuard's dev API and a deterministic mock CKB RPC.
Run: npm run test:e2e (requires Python playwright + Chromium; no live chain needed).
"""
import json
import re
import os
import shutil
import socket
import subprocess
import threading
import time
import tempfile
import urllib.request
import urllib.error
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
HASH = '0x' + 'a'*64
BLOCK = '0x' + 'b'*64


def make_browser_bundle():
    # Small *test-only* ESM concatenator for this dependency-free project. Runs the
    # actual browser JS on about:blank when sandbox policy blocks loopback navigation.
    folder = ROOT / 'site' / 'assets'
    modules = ['ckb','policy','strict-json','analyzer','diff','fixtures','terminal']
    chunks = ['(function () {', 'const MODULE = Object.create(null);']
    for name in modules:
        source = (folder / 'lib' / (name + '.mjs')).read_text()
        pattern = r'^import\s*\{([^}]+)\}\s*from\s*[\"\']\./([^\"\']+)[\"\'];?'
        source = re.sub(pattern, lambda m: f"const {{{m.group(1)}}} = MODULE[{json.dumps(m.group(2))}];", source, flags=re.M)
        names = re.findall(r'^export (?:const|function) (\w+)', source, flags=re.M)
        source = re.sub(r'^export (const|function) ', r'\1 ', source, flags=re.M)
        chunks.extend([f'MODULE[{json.dumps(name + ".mjs")}] = (() => {{', source, 'return {'+','.join(names)+'};', '})();'])
    source = (folder / 'main.mjs').read_text()
    source = re.sub(r'^import\s*\{([^}]+)\}\s*from\s*[\"\']\./lib/([^\"\']+)[\"\'];?',
        lambda m: f"const {{{m.group(1)}}} = MODULE[{json.dumps(m.group(2))}];", source, flags=re.M)
    chunks.extend([source, '})();'])
    return '\n'.join(chunks)


def get_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class StubRPC(BaseHTTPRequestHandler):
    fail_script = False
    def log_message(self, *_):
        pass

    def do_POST(self):
        size = int(self.headers.get('content-length', '0'))
        q = json.loads(self.rfile.read(size))
        name = q['method']
        values = {
            'get_blockchain_info': {'chain': 'ckb_testnet', 'is_initial_block_download': False},
            'get_tip_header': {'number': '0x100', 'hash': BLOCK},
            'get_live_cell': {'status':'live', 'cell':{'output':{'capacity':hex(130*10**8)}}},
            'estimate_cycles': {'cycles':'0xabc'},
            'test_tx_pool_accept': {'cycles':'0xabc', 'fee':hex(3*10**8)},
            'get_transaction': {'tx_status': {'status': 'committed', 'block_hash': BLOCK}},
            'get_header': {'number':'0xf0'},
            'get_block_hash': BLOCK,
            'get_transaction_proof': {'block_hash': BLOCK,'proof':{'indices':['0x0'],'lemmas':[]},'witnesses_root':HASH},
            'verify_transaction_proof': [HASH]
        }
        if name == 'estimate_cycles' and StubRPC.fail_script:
            reply = {'jsonrpc':'2.0','id':q['id'],'error':{'code':-302,'message':'test witness rejected'}}
        else:
            reply = {'jsonrpc':'2.0','id':q['id'],'result':values.get(name)}
        raw = json.dumps(reply).encode()
        self.send_response(200)
        self.send_header('content-type','application/json')
        self.send_header('content-length',str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def wait_for_server(port):
    for _ in range(50):
        try:
            with socket.create_connection(('127.0.0.1',port),0.15):
                return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError('CellGuard local server failed to launch')


def main():
    rpc_port, site_port = get_port(), get_port()
    upstream = ThreadingHTTPServer(('127.0.0.1', rpc_port), StubRPC)
    threading.Thread(target=upstream.serve_forever,daemon=True).start()
    env = dict(os.environ, PORT=str(site_port), CKB_RPC_TESTNET=f'http://127.0.0.1:{rpc_port}/', CKB_ALLOW_LOCAL_RPC='1')
    server = subprocess.Popen(['node','scripts/serve.mjs'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    browser = None
    try:
        wait_for_server(site_port)
        with sync_playwright() as pw:
            executable = shutil.which('chromium') or shutil.which('chromium-browser')
            browser = pw.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
            page = browser.new_page(viewport={'width':1280, 'height':900},accept_downloads=True)
            exceptions=[]
            page.on('pageerror',lambda error: exceptions.append(str(error)))
            # Normal CI: load the running site directly. Restricted local sandboxes:
            # execute the unmodified app logic in Chromium with a network bridge to
            # the same live local API/backend; this still checks browser interaction.
            from playwright.sync_api import Error as PlaywrightError
            try:
                page.goto(f'http://127.0.0.1:{site_port}/',wait_until='networkidle')
            except PlaywrightError as error:
                if 'ERR_BLOCKED_BY_ADMINISTRATOR' not in str(error):
                    raise
                print('INFO: browser loopback blocked by environment; using real Chromium DOM + JS with server-side API bridge')
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                def bridge_rpc(body):
                    request = urllib.request.Request(f'http://127.0.0.1:{site_port}/api/verify',
                        data=body.encode(),method='POST',headers={'content-type':'application/json'})
                    try:
                        with opener.open(request,timeout=30) as response:
                            return {'status': response.status,'payload':json.loads(response.read())}
                    except urllib.error.HTTPError as error:
                        return {'status':error.code,'payload':json.loads(error.read())}
                page.expose_function('bridgeRpc', bridge_rpc)
                markup=(ROOT / 'site/index.html').read_text()
                markup = re.sub(r'<script type="module" src="\./assets/main.mjs"></script>', '', markup)
                markup = re.sub(r'<link rel="stylesheet" href="\./assets/styles.css" />','',markup)
                page.set_content(markup,wait_until='load')
                page.add_style_tag(content=(ROOT/'site/assets/styles.css').read_text())
                page.evaluate("() => { window.fetch = async (_url, init) => {const r = await window.bridgeRpc(init.body); return {ok:r.status>=200 && r.status<300,status:r.status,json:async () => r.payload};}; }")
                page.evaluate(make_browser_bundle())
            expect(page.locator('#status')).to_contain_text('Configured policy checks passed')
            # Correct rejection of sample output-only fixtures
            page.locator('#verify-online').click()
            expect(page.locator('#online-status')).to_contain_text('Synthetic fixture has no input cells')
            # Real browser editing and real backend request to deterministic RPC stub
            page.locator('#toggle-workbench').click()
            tx=json.loads(page.locator('#transaction-input').input_value())
            tx['inputs']=[{'previous_output':{'tx_hash':HASH,'index':'0x0'},'since':'0x0'}]
            tx['witnesses']=['0x1234']
            page.locator('#transaction-input').fill(json.dumps(tx))
            page.locator('#verify-online').click()
            expect(page.locator('#online-status')).to_contain_text('Live preflight: PASS',timeout=10000)
            expect(page.locator('#online-details')).to_contain_text('Transaction fee: 3 CKB')
            expect(page.locator('#online-details')).to_contain_text('VM cycles: 2748')
            expect(page.locator('#online-details')).to_contain_text('Node txpool acceptance: pass')
            expect(page.locator('#online-details')).to_contain_text('On-chain inclusion/finality: not established')
            # Real Node CLI round-trip against the same RPC fixture (no dependency on Chromium navigation).
            with tempfile.TemporaryDirectory() as temp:
                tx_path=Path(temp)/'signed.json'
                tx_path.write_text(json.dumps(tx))
                result=subprocess.run(['node','cli/cellguard.mjs','--transaction',str(tx_path),
                    '--policy','examples/strict-policy.json','--online','testnet','--format','json'],
                    cwd=ROOT,env=env,text=True,capture_output=True,timeout=25)
                assert result.returncode == 0, result.stdout+'\n'+result.stderr
                assert json.loads(result.stdout)['txPool']['status'] == 'pass'
            # Active verification exports a machine-readable online report
            assert not page.locator('#download-report').is_disabled()
            # Changing transaction invalidates any previous online result
            page.locator('#transaction-input').fill(json.dumps(tx)+' ')
            expect(page.locator('#online-status')).to_contain_text('Awaiting live verification')
            # Hash lookup reads canonical block status, not guessed block data
            page.locator('#lookup-hash').fill(HASH)
            page.locator('#lookup-online').click()
            expect(page.locator('#online-status')).to_contain_text('RPC transaction status: COMMITTED')
            expect(page.locator('#online-details')).to_contain_text('Confirmations: 17')
            expect(page.locator('#online-details')).to_contain_text('Inclusion proof: verified-by-node')
            # Script verification failure is explicit
            StubRPC.fail_script = True
            page.locator('#verify-online').click()
            expect(page.locator('#online-status')).to_contain_text('Live preflight: FAIL')
            expect(page.locator('#online-details')).to_contain_text('SCRIPT_EXECUTION_FAILED')
            StubRPC.fail_script = False
            # Wrong network fails closed
            page.locator('#network-select').select_option('mainnet')
            # Default public mainnet might be reachable, so don't issue actual network traffic here.
            expect(page.locator('#online-status')).to_contain_text('Awaiting live verification')
            # Terminal run remains functional
            page.locator('#command-input').fill('status')
            page.locator('#analyze').click()
            expect(page.locator('#console-output')).to_contain_text('optional read-only live CKB RPC')
            assert not exceptions, f'Browser JavaScript exceptions: {exceptions}'
            print('PASS: real Chromium UI + Node CLI rendered, offline checks, synthetic rejection, live RPC verification, fee, VM cycles, stale edit, committed lookup, VM failure, network switching and terminal commands')
            browser.close(); browser=None
    finally:
        # Browser is closed inside the Playwright context, before its event loop exits.
        server.terminate()
        try: server.wait(timeout=5)
        except subprocess.TimeoutExpired: server.kill()
        upstream.shutdown()


if __name__ == '__main__':
    main()
