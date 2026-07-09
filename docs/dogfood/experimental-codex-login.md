# Experimental Codex-like Login Dogfood Report

Manual real-account dogfood evidence only. Use this checklist only after explicit acceptance for the current task. Keep completed reports in ignored local evidence locations unless a task asks for a sanitized excerpt. This is not CI evidence, not official OAuth evidence, not production login evidence, not release evidence, not marketplace evidence, not signing evidence, not support-readiness evidence, and not a publication gate.

The experimental Codex-like path remains high-risk, private-endpoint-style, non-default, account-specific, and separate from the safe/default API-key or project-key provider setup. Do not paste secrets, authorization headers, bearer tokens, access tokens, refresh tokens, auth codes, PKCE verifiers, cookies, secret URL query or fragment values, raw provider responses, raw prompts, raw file bodies, raw diffs, private absolute paths, bridge dumps, or browser storage dumps.

## Run metadata

- Surface: <web/dev GUI | VS Code plugin | not run>
- Runtime launch/connect status: <runtime auto-launched | runtime connected | runtime unavailable | blocked with sanitized reason | not run>
- Date label: <YYYY-MM-DD or sanitized sprint label | not run>
- Build/artifact label: <local dev checkout | VS Code dev-preview artifact family/name | not run>
- Provider path under test: experimental Codex-like account login only; safe/default API-key or project-key path remains the approved real-provider path

## Experimental login lifecycle

- Login start outcome: <started and browser handoff shown | blocked by runtime | unsafe authorization URL blocked | unavailable | not run>
- Pending status outcome: <pending visible with manual exchange guidance | expired before exchange | state mismatch handled | not run>
- Exchange outcome: <connected with sanitized status | denied | expired | provider rejected | sanitized error | not run>
- Connected status evidence: <sanitized account label/scopes/expiry visible | redacted hint visible | connected status unavailable | not run>
- Disconnect outcome: <disconnect cleared experimental account auth | disconnect unavailable | not run>

## First chat result

- Provider selection expectation: <experimental account auth used because no safer ready provider won | API-key/project-key path won by precedence | Demo Mode won by precedence | not run>
- First chat result: <streamed answer visible | failed with sanitized provider category | blocked before send | not run>
- Recovery after first chat: <none | reconnect needed | API-key fallback used | provider/model unavailable | not run>

## Optional VS Code controlled task readiness note

- VS Code host readiness: <runtime host.ready visible | controlled task surface visible | unsupported or blocked with sanitized reason | not run>
- Controlled task handoff note: <ready for later S140 manual task | not attempted | blocked with sanitized reason | not run>
- Authority boundary observed: <no automatic task execution | no workspace mutation from login alone | not run>

## Disconnect and reconnect observations

- Disconnect observation: <experimental auth removed | API-key fallback preserved | disconnect failed safely | not run>
- Reconnect observation: <reconnect started | pending recovered | exchange retried | reconnect blocked with sanitized reason | not run>
- Refresh/expiry observation: <refresh invisible and chat still worked | expired state visible | reconnect required | not observed | not run>

## Known issue categories

- Browser handoff issue: <none | pop-up blocked | unsafe URL blocked | manual code unclear | not run>
- Exchange issue: <none | denied | expired | state mismatch | provider rejected | sanitized runtime error | not run>
- Chat issue: <none | provider unauthorized | model unavailable | streaming interrupted | safer provider precedence surprise | not run>
- VS Code host issue: <none | runtime launch/connect issue | host.ready issue | controlled task surface not ready | not run>
- Documentation/UI issue: <none | copy unclear | recovery unclear | risk framing unclear | not run>

## Sanitized evidence checklist

- API keys absent: <checked | issue fixed before sharing | not run>
- Bearer or authorization headers absent: <checked | issue fixed before sharing | not run>
- Access tokens, refresh tokens, auth codes, and PKCE verifiers absent: <checked | issue fixed before sharing | not run>
- Cookies absent: <checked | issue fixed before sharing | not run>
- Secret URL query and fragment values absent: <checked | issue fixed before sharing | not run>
- Raw provider responses absent: <checked | issue fixed before sharing | not run>
- Raw prompts absent: <checked | issue fixed before sharing | not run>
- Raw file bodies and raw diffs absent: <checked | issue fixed before sharing | not run>
- Private absolute paths absent: <checked | issue fixed before sharing | not run>
- Bridge dumps absent: <checked | issue fixed before sharing | not run>
- Browser storage dumps absent: <checked | issue fixed before sharing | not run>

## Explicit non-claims

- Official OAuth claim: not claimed
- Production login claim: not claimed
- Release or marketplace readiness claim: not claimed
- Signing, notarization, or support readiness claim: not claimed
- CI real-provider automation claim: not claimed
- Hosted Yet AI backend/account/managed gateway/product credit/cloud workspace requirement: not required for this local dogfood checklist

## Result

- Result status: <connected and first chat worked | connected but first chat blocked | login blocked | failed closed | not run>
- Sanitized summary: <short safe label-only summary | not run>
- Follow-up needed: <sanitized follow-up summary or none | not run>
