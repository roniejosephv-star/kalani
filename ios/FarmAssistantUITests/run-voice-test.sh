#!/bin/bash
set -euo pipefail
if [[ $# -lt 3 || $# -gt 4 ]]; then
    echo "Usage: bash $0 simulator-udid disposable-token-file question.m4a|--mic [port]" >&2
    exit 2
fi
umask 077
test_root=$(mktemp -d /private/tmp/farm-voice-test.XXXXXX)
project="$(cd "$(dirname "$0")/.." && pwd)/FarmAssistant.xcodeproj"
destination="platform=iOS Simulator,id=$1"
echo "Private simulator result directory: $test_root"
xcodebuild -quiet -project "$project" -scheme FarmAssistant -destination "$destination" \
    -derivedDataPath "$test_root/build" FARM_DEMO_SUFFIX=.stability \
    CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build-for-testing

python3 - "$test_root/build/Build/Products" "$2" "$3" "${4:-18787}" <<'PY'
import base64
import os
import pathlib
import plistlib
import sys

build_dir, token_file, audio = map(pathlib.Path, sys.argv[1:4])
test_run = plistlib.loads(next(build_dir.glob('FarmAssistant_*.xctestrun')).read_bytes())
targets = ([target for config in test_run['TestConfigurations'] for target in config['TestTargets']]
           if 'TestConfigurations' in test_run else [test_run['FarmAssistantUITests']])
env = next(target for target in targets if target['BlueprintName'] == 'FarmAssistantUITests').setdefault('EnvironmentVariables', {})
env.update(FARM_API_URL=f'http://127.0.0.1:{int(sys.argv[4])}', FARM_SESSION_TOKEN=token_file.read_text().strip(),
           FARM_TEST_LOCALE=os.environ.get('FARM_TEST_LOCALE', 'ta-IN'))
if str(audio) == '--mic':
    env['FARM_UI_TEST_MIC'] = '1'
else:
    env['FARM_UI_TEST_AUDIO'] = base64.b64encode(audio.read_bytes()).decode()
(build_dir / 'VoiceTest.xctestrun').write_bytes(plistlib.dumps(test_run))
PY

xcodebuild -xctestrun "$test_root/build/Build/Products/VoiceTest.xctestrun" \
    -destination "$destination" -parallel-testing-enabled NO \
    -resultBundlePath "$test_root/voice.xcresult" test-without-building
