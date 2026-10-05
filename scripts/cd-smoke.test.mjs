import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./cd-smoke.sh", import.meta.url);
const sha = "0123456789abcdef0123456789abcdef01234567";

function runSmoke(mode) {
  const dir = mkdtempSync(join(tmpdir(), "cd-smoke-"));
  const log = join(dir, "args");
  writeFileSync(
    join(dir, "curl"),
    `#!/bin/bash
printf '%s\\n' "\$*" >> ${JSON.stringify(log)}
url=""
out=""
hdr=""
prev=""
for arg in "\$@"; do
  case "\$prev" in
    -o) out="\$arg" ;;
    -D) hdr="\$arg" ;;
  esac
  case "\$arg" in
    http*|https*) url="\$arg" ;;
  esac
  prev="\$arg"
done
mode=${JSON.stringify(mode)}
sha=${JSON.stringify(sha)}
if [[ "\$mode" == "curl-home" && "\$url" != *build.txt* ]]; then
  echo "curl: (6) Could not resolve host" >&2
  exit 6
fi
code=200
body="<meta name=\\"flow-build\\" content=\\"\${sha}\\" />"
type="text/html"
case "\$url" in
  *build.txt*)
    printf '%s\\n' "\$sha"
    exit 0
    ;;
  *settings*)
    if [[ "\$mode" == "settings" ]]; then code=404; type="text/plain"; body="no"; fi
    if [[ "\$mode" == "settings-body" ]]; then body="<html>no stamp</html>"; fi
    ;;
  *no-such-file*)
    if [[ "\$mode" == "asset" ]]; then code=200; body="present"; type="text/html";
    else code=404; body="missing"; type="text/html"; fi
    ;;
  *)
    if [[ "\$mode" == "home" ]]; then body="<html>no stamp</html>"; fi
    if [[ "\$mode" == "home-late" ]]; then
      count=${JSON.stringify(join(dir, "home-n"))}
      n=0
      if [[ -f "\$count" ]]; then n=\$(cat "\$count"); fi
      n=\$((n + 1))
      printf '%s' "\$n" > "\$count"
      if [[ "\$n" -lt 2 ]]; then body="<html>no stamp</html>"; fi
    fi
    ;;
esac
if [[ -n "\$out" ]]; then printf '%s' "\$body" > "\$out"; fi
if [[ -n "\$hdr" ]]; then printf 'HTTP/2 %s\\ncontent-type: %s\\n' "\$code" "\$type" > "\$hdr"; fi
printf '%s' "\$code"
`,
  );
  chmodSync(join(dir, "curl"), 0o755);
  const result = spawnSync("bash", [script.pathname, sha], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SMOKE_RETRY_PAUSE: "0" },
  });
  const args = readFileSync(log, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, args };
}

test("smoke exits match the Pages outcomes", () => {
  const missingSha = spawnSync("bash", [script.pathname], { encoding: "utf8" });
  assert.equal(missingSha.status, 1);
  assert.match(missingSha.stdout, /Expected the commit SHA/);

  const ok = runSmoke("ok");
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.match(ok.stdout, /Smoke passed/);
  assert.match(ok.args, new RegExp(`build\\.txt\\?n=${sha}-1`));
  assert.match(ok.args, new RegExp(`/\\?n=${sha}`));
  assert.match(ok.args, new RegExp(`/settings\\?preview=1&n=${sha}`));
  assert.match(ok.args, new RegExp(`/assets/no-such-file\\.js\\?n=${sha}`));

  const home = runSmoke("home");
  assert.equal(home.status, 1);
  assert.match(home.stdout, /homepage did not include build/);
  assert.match(home.args, new RegExp(`pages\\.dev/\\?n=${sha}-18`));
  assert.equal(home.args.includes("/settings"), false);

  const late = runSmoke("home-late");
  assert.equal(late.status, 0, late.stderr + late.stdout);
  assert.match(late.stdout, /homepage is not/);
  assert.match(late.args, new RegExp(`pages\\.dev/\\?n=${sha}-1`));
  assert.match(late.args, new RegExp(`pages\\.dev/\\?n=${sha}-2`));
  assert.equal(late.args.includes(`/?n=${sha}-3`), false);
  assert.match(late.args, /\/settings\?preview=1/);

  const curlHome = runSmoke("curl-home");
  assert.equal(curlHome.status, 1);
  assert.match(curlHome.stdout, /Could not fetch/);
  assert.match(curlHome.stdout, /Could not resolve host/);

  const settings = runSmoke("settings");
  assert.equal(settings.status, 2);
  assert.match(settings.stdout, /not 200 HTML/);

  const settingsBody = runSmoke("settings-body");
  assert.equal(settingsBody.status, 1);
  assert.match(settingsBody.stdout, /\/settings did not include build/);

  const asset = runSmoke("asset");
  assert.equal(asset.status, 3);
  assert.match(asset.stdout, /missing asset returned 200, not 404/);
});
