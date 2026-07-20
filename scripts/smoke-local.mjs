import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";

const rootDir = process.cwd();
const token = `smoke-token-${crypto.randomUUID()}`;
const fakeApiKey = `sk-smoke-secret-${crypto.randomUUID()}`;
const fakeNoModelApiKey = `sk-smoke-no-model-secret-${crypto.randomUUID()}`;
const fakeOpenAiApiKey = `sk-smoke-openai-secret-${crypto.randomUUID()}`;
const chatId = `smoke-chat-${crypto.randomUUID()}`;
const providerId = `zzz-smoke-provider-${Date.now()}`;
const noModelProviderId = `aaa-smoke-no-model-${Date.now()}`;
const activeContextDisplayPath = "src/smoke-active-context.ts";
const activeContextWorkspacePath = "packages/smoke/src/smoke-active-context.ts";
const activeContextLanguage = "typescript";
const activeContextSelection = `const smokeContextMarker = "ctx-${crypto.randomUUID()}";`;
const activeContextUserRequest = "Explain the selected smoke context.";
const timeoutMs = 120_000;

let engine;
let mockProvider;
let mockCodexTokenEndpoint;
let mockCodexChatEndpoint;
let tempHome;
let providerAuth;
let providerRequestBody = "";
let codexTokenRequestBody = "";
let codexTokenRequestCount = 0;
let codexChatAuth;
let codexChatRequestBody = "";
let codexChatRequestCount = 0;
let callbackPort;

try {
  tempHome = await makeTempHome();
  const enginePort = await freePort();
  callbackPort = await freePort();
  mockProvider = await startMockProvider();
  engine = startEngine(enginePort, callbackPort, tempHome);
  const baseUrl = `http://127.0.0.1:${enginePort}`;
  await waitForEngine(baseUrl);

  const ping = await requestJson(baseUrl, "/v1/ping");
  assert(ping.ready === true, "ping did not report ready runtime");
  assert(ping.productId === "yet-ai", "ping returned unexpected product identity");

  const caps = await requestJson(baseUrl, "/v1/caps");
  assert(caps.runtime?.mode === "local", "caps did not report local runtime mode");
  assert(caps.runtime?.cloudRequired === false, "caps unexpectedly require cloud runtime");
  assert(caps.runtime?.providerAccess === "direct", "caps did not report direct provider access");
  assert(Array.isArray(caps.capabilities) && caps.capabilities.includes("chat"), "caps did not include chat capability");

  const providerAuthStatus = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(providerAuthStatus.provider === "openai", "provider-auth status returned unexpected provider");
  assert(providerAuthStatus.configured === false, "provider-auth default status was unexpectedly configured");
  assert(providerAuthStatus.status === "login_unavailable", "provider-auth default status was not login_unavailable");
  assert(providerAuthStatus.authSource === "none", "provider-auth default auth source was not none");
  assert(providerAuthStatus.supportsLogin === false, "provider-auth default status unexpectedly supports login");
  assert(providerAuthStatus.supportsApiKey === true, "provider-auth default status did not support API-key fallback");
  assert(providerAuthStatus.cloudRequired === false, "provider-auth default status unexpectedly requires cloud");

  const providerAuthStart = await requestJson(baseUrl, "/v1/provider-auth/openai/start", {
    method: "POST",
    body: JSON.stringify({ mock: true })
  });
  assert(providerAuthStart.status === "pending", "provider-auth mock start did not return pending status");
  assert(providerAuthStart.authSource === "oauth", "provider-auth mock start did not use oauth auth source");
  assert(providerAuthStart.supportsLogin === true, "provider-auth mock start did not support login");
  assert(providerAuthStart.cloudRequired === false, "provider-auth mock start unexpectedly requires cloud");
  assert(providerAuthStart.authorizationUrl?.startsWith("http://127.0.0.1/mock-oauth/authorize"), "provider-auth mock start returned unexpected authorization URL");
  assert(typeof providerAuthStart.sessionId === "string" && providerAuthStart.sessionId.length > 0, "provider-auth mock start did not return a session id");
  const providerAuthState = new URL(providerAuthStart.authorizationUrl).searchParams.get("state");
  assert(providerAuthState?.startsWith("mock-state-"), "provider-auth mock start did not return mock state");

  const providerAuthExchange = await requestJson(baseUrl, "/v1/provider-auth/openai/exchange", {
    method: "POST",
    body: JSON.stringify({
      sessionId: providerAuthStart.sessionId,
      state: providerAuthState,
      code: "mock-code-smoke"
    })
  });
  assert(providerAuthExchange.configured === true, "provider-auth mock exchange did not configure auth");
  assert(providerAuthExchange.status === "connected", "provider-auth mock exchange did not return connected status");
  assert(providerAuthExchange.authSource === "oauth", "provider-auth mock exchange did not use oauth auth source");
  assert(providerAuthExchange.redacted === "mock-oauth-...connected", "provider-auth mock exchange returned unexpected redacted hint");
  assert(providerAuthExchange.cloudRequired === false, "provider-auth mock exchange unexpectedly requires cloud");

  const providerAuthConnected = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(providerAuthConnected.configured === true, "provider-auth connected status was not configured");
  assert(providerAuthConnected.status === "connected", "provider-auth connected status was not connected");
  assert(providerAuthConnected.authSource === "oauth", "provider-auth connected status did not use oauth auth source");

  const providerAuthDisconnect = await requestJson(baseUrl, "/v1/provider-auth/openai/disconnect", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert(providerAuthDisconnect.success === true, "provider-auth disconnect did not report success");
  assert(providerAuthDisconnect.status === "revoked", "provider-auth disconnect did not return revoked status");

  const providerAuthCleared = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(providerAuthCleared.configured === false, "provider-auth cleared status was unexpectedly configured");
  assert(providerAuthCleared.status === "login_unavailable", "provider-auth cleared status was not login_unavailable");

  mockCodexTokenEndpoint = await startMockCodexTokenEndpoint();
  mockCodexChatEndpoint = await startMockCodexChatEndpoint();
  const codexStart = await requestJson(baseUrl, "/v1/provider-auth/openai/start", {
    method: "POST",
    body: JSON.stringify({
      experimentalCodexLike: true,
      tokenEndpointUrl: mockCodexTokenEndpoint.url,
      chatEndpointUrl: mockCodexChatEndpoint.baseUrl
    })
  });
  assert(codexStart.status === "pending", "experimental Codex-like start did not return pending status");
  assert(codexStart.authSource === "oauth", "experimental Codex-like start did not use oauth auth source");
  assert(codexStart.supportsLogin === true, "experimental Codex-like start did not support login");
  assert(codexStart.cloudRequired === false, "experimental Codex-like start unexpectedly requires cloud");
  assert(codexStart.authorizationUrl?.startsWith("https://auth.openai.com/oauth/authorize?"), "experimental Codex-like start returned unexpected authorization URL");
  assert(typeof codexStart.sessionId === "string" && codexStart.sessionId.startsWith("codex-"), "experimental Codex-like start did not return a Codex-like session id");
  assert(String(codexStart.message ?? "").includes("Experimental Codex-like"), "experimental Codex-like start did not return risk message");
  const codexAuthorizeUrl = new URL(codexStart.authorizationUrl);
  const codexState = codexAuthorizeUrl.searchParams.get("state");
  const codexChallenge = codexAuthorizeUrl.searchParams.get("code_challenge");
  assert(typeof codexState === "string" && codexState.length > 20, "experimental Codex-like start did not return state");
  assert(typeof codexChallenge === "string" && codexChallenge.length > 20, "experimental Codex-like start did not return PKCE challenge");
  assert(codexStart.sessionId !== codexState, "experimental Codex-like session id and state were not distinct");
  assert(codexStart.sessionId !== codexChallenge, "experimental Codex-like session id and challenge were not distinct");
  assert(codexState !== codexChallenge, "experimental Codex-like state and challenge were not distinct");

  const codexFailure = await requestJson(baseUrl, "/v1/provider-auth/openai/exchange", {
    method: "POST",
    body: JSON.stringify({
      sessionId: codexStart.sessionId,
      state: codexState,
      code: "codex-code-smoke-failure-secret"
    }),
    expectedStatus: 502
  });
  assert(codexFailure.error === "provider auth token exchange failed", "experimental Codex-like failed exchange returned unexpected error");
  assert(codexTokenRequestCount === 1, "experimental Codex-like failed exchange did not call mock token endpoint once");

  const codexPendingAfterFailure = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(codexPendingAfterFailure.status === "pending", "experimental Codex-like failed exchange did not preserve pending status");
  assert(codexPendingAfterFailure.sessionId === codexStart.sessionId, "experimental Codex-like failed exchange did not preserve retry session");
  assert(codexPendingAfterFailure.authSource === "oauth", "experimental Codex-like pending retry did not use oauth auth source");
  assert(codexPendingAfterFailure.configured === false, "experimental Codex-like pending retry was unexpectedly configured");

  const codexExchange = await requestJson(baseUrl, "/v1/provider-auth/openai/exchange", {
    method: "POST",
    body: JSON.stringify({
      sessionId: codexStart.sessionId,
      state: codexState,
      code: "codex-code-smoke-secret"
    })
  });
  assert(codexExchange.configured === true, "experimental Codex-like retry exchange did not configure auth");
  assert(codexExchange.status === "connected", "experimental Codex-like retry exchange did not return connected status");
  assert(codexExchange.authSource === "oauth", "experimental Codex-like retry exchange did not use oauth auth source");
  assert(codexExchange.accountLabel === "smoke-user@example.test", "experimental Codex-like retry exchange returned unexpected account label");
  assert(codexExchange.cloudRequired === false, "experimental Codex-like retry exchange unexpectedly requires cloud");

  assert(codexTokenRequestCount === 2, "experimental Codex-like retry exchange did not call mock token endpoint twice total");
  const parsedCodexTokenBodies = codexTokenRequestBody.trim().split("\n").map(parseFormBody);
  const parsedFailedCodexTokenBody = parsedCodexTokenBodies[0];
  const parsedCodexTokenBody = parsedCodexTokenBodies[1];
  assert(parsedFailedCodexTokenBody.grant_type === "authorization_code", "experimental Codex-like failed exchange used unexpected grant type");
  assert(parsedFailedCodexTokenBody.code === "codex-code-smoke-failure-secret", "experimental Codex-like failed exchange did not send auth code to mock token endpoint");
  assert(parsedCodexTokenBody.grant_type === "authorization_code", "experimental Codex-like retry exchange used unexpected grant type");
  assert(parsedCodexTokenBody.code === "codex-code-smoke-secret", "experimental Codex-like retry exchange did not send auth code to mock token endpoint");
  assert(parsedCodexTokenBody.redirect_uri === codexAuthorizeUrl.searchParams.get("redirect_uri"), "experimental Codex-like retry exchange did not preserve the authorize redirect URI");
  assert(typeof parsedCodexTokenBody.code_verifier === "string" && parsedCodexTokenBody.code_verifier.length > 20, "experimental Codex-like retry exchange did not send PKCE verifier to mock token endpoint");
  assert(parsedFailedCodexTokenBody.code_verifier === parsedCodexTokenBody.code_verifier, "experimental Codex-like retry did not reuse pending verifier");
  assert(parsedCodexTokenBody.code_verifier !== codexState, "experimental Codex-like verifier reused state");
  assert(parsedCodexTokenBody.code_verifier !== codexChallenge, "experimental Codex-like verifier reused challenge");

  const codexStatus = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(codexStatus.configured === true, "experimental Codex-like status was not configured");
  assert(codexStatus.status === "connected", "experimental Codex-like status was not connected");
  assert(codexStatus.authSource === "oauth", "experimental Codex-like status did not use oauth auth source");
  assert(codexStatus.sessionId === undefined, "experimental Codex-like connected status exposed session id");
  assert(codexStatus.authorizationUrl === undefined, "experimental Codex-like connected status exposed authorization URL");
  assert(codexStatus.redacted === "co...et", "experimental Codex-like connected status returned unexpected redacted hint");
  assert(codexStatus.accountLabel === "smoke-user@example.test", "experimental Codex-like connected status returned unexpected account label");

  const codexIncompleteChatCount = codexChatRequestCount;
  const incompleteCodexDisconnect = await requestJson(baseUrl, "/v1/provider-auth/openai/disconnect", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert(incompleteCodexDisconnect.success === true, "experimental Codex-like pre-chat disconnect did not report success");
  assert(incompleteCodexDisconnect.status === "revoked", "experimental Codex-like pre-chat disconnect did not return revoked status");
  assert(incompleteCodexDisconnect.authSource === "none", "experimental Codex-like pre-chat disconnect did not return sanitized auth source");

  const incompleteCodexChatId = `smoke-codex-incomplete-chat-${crypto.randomUUID()}`;
  const incompleteCodexSubscription = subscribe(baseUrl, incompleteCodexChatId, { finishOnError: true });
  const incompleteCodexCommand = await requestJson(baseUrl, `/v1/chats/${encodeURIComponent(incompleteCodexChatId)}/commands`, {
    method: "POST",
    body: JSON.stringify({
      requestId: `smoke-codex-incomplete-${crypto.randomUUID()}`,
      type: "user_message",
      payload: { content: "This should not use disconnected OAuth." }
    })
  });
  assert(incompleteCodexCommand.accepted === true, "experimental Codex-like disconnected chat command was not accepted");
  const { events: incompleteCodexEvents, raw: incompleteCodexRaw } = await incompleteCodexSubscription;
  assert(incompleteCodexEvents.some((event) => event.type === "error" && event.payload?.code === "provider_not_configured"), "experimental Codex-like disconnected chat did not report provider-not-configured");
  assert(codexChatRequestCount === codexIncompleteChatCount, "experimental Codex-like disconnected OAuth unexpectedly called mock chat endpoint");

  const codexRestart = await requestJson(baseUrl, "/v1/provider-auth/openai/start", {
    method: "POST",
    body: JSON.stringify({
      experimentalCodexLike: true,
      tokenEndpointUrl: mockCodexTokenEndpoint.url,
      chatEndpointUrl: mockCodexChatEndpoint.baseUrl
    })
  });
  assert(codexRestart.status === "pending", "experimental Codex-like restart did not return pending status");
  const codexRestartState = new URL(codexRestart.authorizationUrl).searchParams.get("state");
  assert(codexRestart.sessionId !== codexStart.sessionId, "experimental Codex-like restart reused prior session id");
  assert(codexRestartState !== codexState, "experimental Codex-like restart reused prior state");
  const codexTransientCallback = await requestCallback(codexRestart.authorizationUrl, "codex-code-smoke-transient-secret");
  assert(codexTransientCallback.status === 502, "experimental Codex-like transient callback did not return HTTP 502");
  assert(codexTransientCallback.body.includes("retry login or the authorization code"), "experimental Codex-like transient callback did not return safe retry text");
  assertNoSecretLeak(codexTransientCallback.raw, [
    { label: "Codex-like transient callback auth code", value: "codex-code-smoke-transient-secret" },
    { label: "Codex-like transient callback state", value: codexRestartState },
    { label: "Codex-like transient provider body", value: "temporary callback provider detail" },
    { label: "raw code query marker", value: "?code=" },
    { label: "raw state query marker", value: "&state=" },
    { label: "private path marker", value: tempHome }
  ]);
  const codexPendingAfterCallbackFailure = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(codexPendingAfterCallbackFailure.status === "pending", "experimental Codex-like transient callback did not preserve pending status");
  assert(codexPendingAfterCallbackFailure.sessionId === codexRestart.sessionId, "experimental Codex-like transient callback did not preserve retry session");
  assert(codexPendingAfterCallbackFailure.lastError === "Login reached Yet AI but token exchange failed (token_http_status_502; http_status=502; oauth_error=server_error). Retry login or use the API-key fallback.", "experimental Codex-like transient callback returned unexpected sanitized diagnostic");

  const codexReconnectCallback = await requestCallback(codexRestart.authorizationUrl, "codex-code-smoke-transient-secret");
  assert(codexReconnectCallback.status === 200, "experimental Codex-like callback did not return HTTP 200");
  assert(codexReconnectCallback.body.includes("Login received. Return to Yet AI."), "experimental Codex-like callback did not return safe success text");
  assertNoSecretLeak(codexReconnectCallback.raw, [
    { label: "Codex-like callback auth code", value: "codex-code-smoke-transient-secret" },
    { label: "Codex-like callback state", value: codexRestartState },
    { label: "Codex-like access token", value: "codex-smoke-access-token-secret" },
    { label: "Codex-like refresh token", value: "codex-smoke-refresh-token-secret" },
    { label: "authorization header marker", value: "authorization: bearer" },
    { label: "cookie marker", value: "cookie" },
    { label: "raw code query marker", value: "?code=" },
    { label: "raw state query marker", value: "&state=" },
    { label: "private path marker", value: tempHome }
  ]);
  const codexReconnect = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(codexReconnect.status === "connected", "experimental Codex-like reconnect did not return connected status");
  assert(codexReconnect.configured === true, "experimental Codex-like callback did not configure auth");
  assert(codexReconnect.sessionId === undefined, "experimental Codex-like callback connected status exposed session id");
  assert(codexReconnect.authorizationUrl === undefined, "experimental Codex-like callback connected status exposed authorization URL");
  assert(codexTokenRequestCount === 4, "experimental Codex-like callback retry did not call mock token endpoint four times total");

  const codexChatId = `smoke-codex-chat-${crypto.randomUUID()}`;
  const codexSubscription = subscribe(baseUrl, codexChatId);
  const codexCommandResponse = await requestJson(baseUrl, `/v1/chats/${encodeURIComponent(codexChatId)}/commands`, {
    method: "POST",
    body: JSON.stringify({
      requestId: `smoke-codex-command-${crypto.randomUUID()}`,
      type: "user_message",
      payload: { content: "Say hello through experimental mock OAuth." }
    })
  });
  assert(codexCommandResponse.accepted === true, "experimental Codex-like chat command was not accepted");

  const { events: codexEvents, raw: codexRaw } = await codexSubscription;
  assert(codexEvents[0]?.type === "snapshot" && codexEvents[0]?.seq === 0, "experimental Codex-like SSE did not start with snapshot");
  assert(codexEvents[0]?.payload?.thread?.id === codexChatId, "experimental Codex-like SSE snapshot used unexpected chat id");
  assert(codexEvents[0]?.payload?.runtime?.streaming === false, "experimental Codex-like SSE snapshot did not expose non-streaming initial state");
  assert(codexEvents[1]?.type === "stream_started" && codexEvents[1]?.payload?.role === "assistant", "experimental Codex-like SSE stream_started event was not received");
  assert(codexEvents[2]?.type === "stream_delta" && codexEvents[2]?.payload?.delta?.content === "OAuth", "experimental Codex-like SSE OAuth delta was not received");
  assert(codexEvents[3]?.type === "stream_delta" && codexEvents[3]?.payload?.delta?.content === " smoke", "experimental Codex-like SSE smoke delta was not received");
  assert(codexEvents[4]?.type === "message_added" && codexEvents[4]?.payload?.message?.role === "assistant" && codexEvents[4]?.payload?.message?.content === "OAuth smoke", "experimental Codex-like SSE assistant message_added event was not received");
  assert(codexEvents[5]?.type === "stream_finished" && codexEvents[5]?.payload?.finishReason === "stop", "experimental Codex-like SSE stream_finished event was not received");
  assert(codexEvents.length === 6, "experimental Codex-like SSE produced unexpected extra events");
  assertMonotonicSequence(codexEvents);

  assert(codexChatRequestCount === 1, "experimental Codex-like mock chat endpoint was not called exactly once");
  assert(codexChatAuth === "Bearer codex-smoke-access-token-secret", "experimental Codex-like mock chat did not receive bearer OAuth token");
  const parsedCodexChatBody = JSON.parse(codexChatRequestBody);
  assert(parsedCodexChatBody.stream === true, "experimental Codex-like chat request was not streaming");
  assert(parsedCodexChatBody.model === "gpt-5-codex", "experimental Codex-like chat request used unexpected model");
  assert(parsedCodexChatBody.input?.[0]?.role === "user", "experimental Codex-like chat request did not send user role");
  assert(parsedCodexChatBody.input?.[0]?.content?.[0]?.text === "Say hello through experimental mock OAuth.", "experimental Codex-like chat request did not send first message content");

  const noModelProviderResponse = await requestJson(baseUrl, "/v1/providers", {
    method: "POST",
    body: JSON.stringify({
      id: noModelProviderId,
      kind: "openai-compatible",
      displayName: "Smoke No Model Provider",
      enabled: true,
      baseUrl: `${mockProvider.baseUrl}/v1`,
      auth: { type: "api_key", apiKey: fakeNoModelApiKey },
      models: [],
      capabilities: { chat: true, completion: false, embeddings: false }
    })
  });
  assert(noModelProviderResponse.id === noModelProviderId, "no-model provider create returned unexpected provider id");
  assert(noModelProviderResponse.auth?.configured === true, "no-model provider create did not report configured auth");

  const providerResponse = await requestJson(baseUrl, "/v1/providers", {
    method: "POST",
    body: JSON.stringify({
      id: providerId,
      kind: "openai-compatible",
      displayName: "Smoke OpenAI Compatible",
      enabled: true,
      baseUrl: `${mockProvider.baseUrl}/v1`,
      auth: { type: "api_key", apiKey: fakeApiKey },
      models: [{ id: "smoke-model", displayName: "Smoke Model" }],
      capabilities: { chat: true, completion: false, embeddings: false }
    })
  });
  assert(providerResponse.id === providerId, "provider create returned unexpected provider id");
  assert(providerResponse.auth?.configured === true, "provider create did not report configured auth");

  const modelsAfterProviders = await requestJson(baseUrl, "/v1/models");
  assert(modelsAfterProviders.models?.[0]?.providerId === providerId, "models summary did not select the first usable provider after no-model provider");
  assert(modelsAfterProviders.models?.[0]?.id === "smoke-model", "models summary did not expose the configured smoke model");

  const providerAuthWithApiKey = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(providerAuthWithApiKey.configured === true, "provider-auth status with API-key provider was not configured");
  assert(providerAuthWithApiKey.supportsApiKey === true, "provider-auth status with API-key provider did not support API-key fallback");

  const subscription = subscribe(baseUrl, chatId);
  const commandResponse = await requestJson(baseUrl, `/v1/chats/${encodeURIComponent(chatId)}/commands`, {
    method: "POST",
    body: JSON.stringify({
      requestId: `smoke-command-${crypto.randomUUID()}`,
      type: "user_message",
      payload: {
        content: activeContextUserRequest,
        context: {
          kind: "active_editor",
          source: "vscode",
          file: {
            displayPath: activeContextDisplayPath,
            workspaceRelativePath: activeContextWorkspacePath,
            languageId: activeContextLanguage
          },
          selection: {
            startLine: 4,
            startCharacter: 2,
            endLine: 4,
            endCharacter: 58,
            text: activeContextSelection
          }
        }
      }
    })
  });
  assert(commandResponse.accepted === true, "chat command was not accepted");

  const { events, raw } = await subscription;
  assert(events[0]?.type === "snapshot" && events[0]?.seq === 0, "SSE did not start with snapshot");
  assert(events.some((event) => event.type === "stream_started"), "SSE stream_started event was not received");
  assert(events.some((event) => event.type === "stream_delta" && event.payload?.delta?.content === "Hello"), "SSE Hello delta was not received");
  assert(events.some((event) => event.type === "stream_delta" && event.payload?.delta?.content === " smoke"), "SSE smoke delta was not received");
  assert(events.some((event) => event.type === "stream_finished"), "SSE stream_finished event was not received");
  assertMonotonicSequence(events);

  assert(providerAuth === `Bearer ${fakeApiKey}`, "mock provider did not receive bearer API key");
  assert(codexChatRequestCount === 1, "API-key provider path did not take precedence over connected experimental OAuth fallback");
  const parsedProviderBody = JSON.parse(providerRequestBody);
  assert(parsedProviderBody.stream === true, "provider request was not streaming");
  assert(parsedProviderBody.model === "smoke-model", "provider request used unexpected model");
  const providerPrompt = parsedProviderBody.messages?.[0]?.content;
  assert(parsedProviderBody.messages?.[0]?.role === "user", "provider request did not send user role");
  assert(typeof providerPrompt === "string", "provider request did not include user message content");
  assert(providerPrompt.includes("IDE context"), "provider request did not include IDE context marker");
  assert(providerPrompt.includes(`File: ${activeContextDisplayPath}`), "provider request did not include safe file display path");
  assert(providerPrompt.includes(`Workspace-relative path: ${activeContextWorkspacePath}`), "provider request did not include safe workspace-relative path");
  assert(providerPrompt.includes(`Language: ${activeContextLanguage}`), "provider request did not include language id");
  assert(providerPrompt.includes(activeContextSelection), "provider request did not include selected text");
  assert(providerPrompt.includes("User request"), "provider request did not include user request marker");
  assert(providerPrompt.includes(activeContextUserRequest), "provider request did not include original user request");

  const historyThread = await requestJson(baseUrl, "/v1/chats", { method: "POST" });
  assert(typeof historyThread.chatId === "string" && historyThread.chatId.startsWith("chat_"), "chat history create returned unexpected chat id");
  assert(historyThread.title === "New chat", "chat history create returned unexpected title");
  assert(Array.isArray(historyThread.messages) && historyThread.messages.length === 0, "chat history create returned unexpected messages");

  const historyContent = "Persist this local smoke chat.";
  const historySubscription = subscribe(baseUrl, historyThread.chatId);
  const historyCommandResponse = await requestJson(baseUrl, `/v1/chats/${encodeURIComponent(historyThread.chatId)}/commands`, {
    method: "POST",
    body: JSON.stringify({
      requestId: `smoke-history-command-${crypto.randomUUID()}`,
      type: "user_message",
      payload: { content: historyContent }
    })
  });
  assert(historyCommandResponse.accepted === true, "chat history command was not accepted");
  const { events: historyEvents, raw: historyRaw } = await historySubscription;
  assert(historyEvents[0]?.type === "snapshot" && historyEvents[0]?.payload?.thread?.id === historyThread.chatId, "chat history SSE snapshot used unexpected thread");
  assert(historyEvents.some((event) => event.type === "stream_finished"), "chat history SSE did not finish");
  assertMonotonicSequence(historyEvents);

  const persistedHistory = await requestJson(baseUrl, `/v1/chats/${encodeURIComponent(historyThread.chatId)}`);
  assert(persistedHistory.chatId === historyThread.chatId, "persisted chat history returned unexpected chat id");
  assert(persistedHistory.title === "New chat", "persisted chat history returned unexpected title");
  assert(Array.isArray(persistedHistory.messages), "persisted chat history returned no messages array");
  assert(persistedHistory.messages.length === 2, "persisted chat history did not include user and assistant messages");
  assert(persistedHistory.messages[0]?.role === "user", "persisted chat history first message was not user");
  assert(persistedHistory.messages[0]?.content === historyContent, "persisted chat history did not preserve user content");
  assert(persistedHistory.messages[0]?.status === "complete", "persisted chat history user message was not complete");
  assert(persistedHistory.messages[1]?.role === "assistant", "persisted chat history second message was not assistant");
  assert(persistedHistory.messages[1]?.content === "Hello smoke", "persisted chat history did not preserve assistant content");
  assert(persistedHistory.messages[1]?.status === "complete", "persisted chat history assistant message was not complete");

  const historySnapshot = await readSnapshot(baseUrl, historyThread.chatId);
  assert(historySnapshot.payload?.thread?.id === historyThread.chatId, "follow-up chat history snapshot returned unexpected thread");
  assert(historySnapshot.payload?.thread?.messages?.length === 2, "follow-up chat history snapshot did not include persisted messages");
  assert(historySnapshot.payload?.thread?.messages?.[0]?.content === historyContent, "follow-up chat history snapshot did not include persisted user message");
  assert(historySnapshot.payload?.thread?.messages?.[1]?.content === "Hello smoke", "follow-up chat history snapshot did not include persisted assistant message");

  const historyList = await requestJson(baseUrl, "/v1/chats");
  const historySummary = historyList.chats?.find((chat) => chat.chatId === historyThread.chatId);
  assert(historySummary, "chat history list did not include persisted chat");
  assert(historySummary.title === "New chat", "chat history list summary returned unexpected title");
  assert(historySummary.messageCount === 2, "chat history list summary returned unexpected message count");
  assert(typeof historySummary.createdAt === "string" && typeof historySummary.updatedAt === "string", "chat history list summary omitted timestamps");

  await requestEmpty(baseUrl, `/v1/chats/${encodeURIComponent(historyThread.chatId)}`, { method: "DELETE", expectedStatus: 204 });
  const historyListAfterDelete = await requestJson(baseUrl, "/v1/chats");
  assert(!historyListAfterDelete.chats?.some((chat) => chat.chatId === historyThread.chatId), "deleted chat history still appeared in list");
  const missingHistory = await requestJson(baseUrl, `/v1/chats/${encodeURIComponent(historyThread.chatId)}`, { expectedStatus: 404 });
  assert(missingHistory.error === "chat not found", "deleted chat history get returned unexpected error");
  const deletedSnapshot = await readSnapshot(baseUrl, historyThread.chatId);
  assert(deletedSnapshot.payload?.thread?.messages?.length === 0, "deleted chat history snapshot returned stale messages");

  const openAiFallbackResponse = await requestJson(baseUrl, "/v1/providers", {
    method: "POST",
    body: JSON.stringify({
      id: "openai-api",
      kind: "openai-compatible",
      displayName: "Smoke OpenAI API Fallback",
      enabled: true,
      baseUrl: `${mockProvider.baseUrl}/v1`,
      auth: { type: "api_key", apiKey: fakeOpenAiApiKey },
      models: [{ id: "smoke-openai-fallback", displayName: "Smoke OpenAI Fallback" }],
      capabilities: { chat: true, completion: false, embeddings: false }
    })
  });
  assert(openAiFallbackResponse.id === "openai-api", "OpenAI API fallback provider create returned unexpected provider id");
  assert(openAiFallbackResponse.auth?.configured === true, "OpenAI API fallback provider create did not report configured auth");

  const codexTerminalDisconnect = await requestJson(baseUrl, "/v1/provider-auth/openai/disconnect", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert(codexTerminalDisconnect.success === true, "experimental Codex-like terminal setup disconnect did not report success");
  assert(codexTerminalDisconnect.status === "api_key_configured", "experimental Codex-like terminal setup disconnect did not preserve API-key fallback");
  assert(codexTerminalDisconnect.authSource === "api_key", "experimental Codex-like terminal setup disconnect did not use API-key fallback");
  assert(codexTerminalDisconnect.configured === true, "experimental Codex-like terminal setup disconnect lost API-key fallback");

  const codexTerminalStart = await requestJson(baseUrl, "/v1/provider-auth/openai/start", {
    method: "POST",
    body: JSON.stringify({
      experimentalCodexLike: true,
      tokenEndpointUrl: mockCodexTokenEndpoint.url,
      chatEndpointUrl: mockCodexChatEndpoint.baseUrl
    })
  });
  const codexTerminalStartStatus = sanitizedProviderAuthStatus(codexTerminalStart);
  assert(codexTerminalStart.status === "pending", `experimental Codex-like terminal start did not return pending status: ${JSON.stringify(codexTerminalStartStatus)}`);
  assert(codexTerminalStart.authSource === "oauth", `experimental Codex-like terminal start did not use OAuth: ${JSON.stringify(codexTerminalStartStatus)}`);
  assert(typeof codexTerminalStart.sessionId === "string" && codexTerminalStart.sessionId.startsWith("codex-"), `experimental Codex-like terminal start did not return a session id: ${JSON.stringify(codexTerminalStartStatus)}`);
  assert(typeof codexTerminalStart.authorizationUrl === "string" && codexTerminalStart.authorizationUrl.startsWith("https://auth.openai.com/oauth/authorize?"), `experimental Codex-like terminal start did not return an authorization URL: ${JSON.stringify(codexTerminalStartStatus)}`);
  const codexTerminalState = new URL(codexTerminalStart.authorizationUrl).searchParams.get("state");
  assert(typeof codexTerminalState === "string" && codexTerminalState.length > 20, "experimental Codex-like terminal start did not return state");
  const codexTerminalCallback = await requestCallback(codexTerminalStart.authorizationUrl, "codex-code-smoke-invalid-grant-secret");
  assert(codexTerminalCallback.status === 502, "experimental Codex-like invalid_grant callback did not return HTTP 502");
  assert(codexTerminalCallback.body.includes("start login again"), "experimental Codex-like invalid_grant callback did not return safe fresh-login text");
  assert(!codexTerminalCallback.body.includes("retry login or the authorization code"), "experimental Codex-like invalid_grant callback incorrectly offered code retry");
  assertNoSecretLeak(codexTerminalCallback.raw, [
    { label: "Codex-like invalid_grant callback auth code", value: "codex-code-smoke-invalid-grant-secret" },
    { label: "Codex-like invalid_grant callback state", value: codexTerminalState },
    { label: "Codex-like invalid_grant provider description", value: "authorization code was already used" },
    { label: "raw code query marker", value: "?code=" },
    { label: "raw state query marker", value: "&state=" },
    { label: "private path marker", value: tempHome }
  ]);
  const codexTerminalStatus = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(codexTerminalStatus.status === "api_key_configured", "experimental Codex-like invalid_grant did not fall back to API-key status");
  assert(codexTerminalStatus.configured === true, "experimental Codex-like invalid_grant lost API-key fallback");
  assert(codexTerminalStatus.authSource === "api_key", "experimental Codex-like invalid_grant did not use API-key fallback");
  assert(codexTerminalStatus.sessionId === undefined, "experimental Codex-like invalid_grant retained retry session");
  assert(codexTerminalStatus.authorizationUrl === undefined, "experimental Codex-like invalid_grant retained authorization URL");
  assert(codexTerminalStatus.lastError === "Login reached Yet AI but token exchange failed (token_http_status_400; http_status=400; oauth_error=invalid_grant). Retry login or use the API-key fallback.", "experimental Codex-like invalid_grant returned unexpected sanitized diagnostic");
  assert(codexTokenRequestCount === 5, "experimental Codex-like invalid_grant did not call mock token endpoint a fifth time");

  const codexDisconnect = await requestJson(baseUrl, "/v1/provider-auth/openai/disconnect", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert(codexDisconnect.success === true, "experimental Codex-like disconnect did not report success");
  assert(codexDisconnect.status === "api_key_configured", "experimental Codex-like disconnect did not preserve API-key fallback status");
  assert(codexDisconnect.authSource === "api_key", "experimental Codex-like disconnect did not return API-key fallback auth source");
  assert(codexDisconnect.configured === true, "experimental Codex-like disconnect did not preserve configured API-key fallback");
  assert(/^sk\.\.\.[A-Za-z0-9_-]{2}$/.test(codexDisconnect.redacted), "experimental Codex-like disconnect returned unexpected fallback redacted hint");
  assert(codexDisconnect.sessionId === undefined, "experimental Codex-like disconnect exposed session id");
  assert(codexDisconnect.authorizationUrl === undefined, "experimental Codex-like disconnect exposed authorization URL");

  const codexClearedStatus = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(codexClearedStatus.configured === true, "experimental Codex-like cleared status did not preserve API-key fallback");
  assert(codexClearedStatus.status === "api_key_configured", "experimental Codex-like cleared status did not return API-key fallback");
  assert(codexClearedStatus.authSource === "api_key", "experimental Codex-like cleared status did not return API-key fallback auth source");
  assert(/^sk\.\.\.[A-Za-z0-9_-]{2}$/.test(codexClearedStatus.redacted), "experimental Codex-like cleared status returned unexpected fallback redacted hint");

  const codexMissingExpiry = await verifyCodexFallbackExpiry(baseUrl, "missing");
  const codexZeroExpiry = await verifyCodexFallbackExpiry(baseUrl, "zero");
  const codexNegativeExpiry = await verifyCodexInvalidExpiry(baseUrl, tempHome, "negative");
  const codexOversizedExpiry = await verifyCodexInvalidExpiry(baseUrl, tempHome, "oversized");

  const clientVisible = JSON.stringify({
    ping,
    caps,
    providerAuthStatus,
    providerAuthStart,
    providerAuthExchange,
    providerAuthConnected,
    providerAuthDisconnect,
    providerAuthCleared,
    codexStart,
    codexFailure,
    codexPendingAfterFailure,
    codexExchange,
    codexStatus,
    incompleteCodexDisconnect,
    incompleteCodexCommand,
    incompleteCodexEvents,
    incompleteCodexRaw,
    codexRestart,
    codexTransientCallback,
    codexPendingAfterCallbackFailure,
    codexReconnectCallback,
    codexReconnect,
    codexCommandResponse,
    codexEvents,
    codexRaw,
    codexTerminalDisconnect,
    codexTerminalStart,
    codexTerminalCallback,
    codexTerminalStatus,
    openAiFallbackResponse,
    codexDisconnect,
    codexClearedStatus,
    codexMissingExpiry,
    codexZeroExpiry,
    codexNegativeExpiry,
    codexOversizedExpiry,
    noModelProviderResponse,
    providerResponse,
    modelsAfterProviders,
    providerAuthWithApiKey,
    commandResponse,
    events,
    raw,
    historyThread,
    historyCommandResponse,
    historyEvents,
    historyRaw,
    persistedHistory,
    historySnapshot,
    historyList,
    historyListAfterDelete,
    missingHistory,
    deletedSnapshot
  });
  const secretMarkers = [
    { label: "runtime token", value: token },
    { label: "provider API key", value: fakeApiKey },
    { label: "no-model provider API key", value: fakeNoModelApiKey },
    { label: "OpenAI fallback API key", value: fakeOpenAiApiKey },
    { label: "mock access token", value: "fake-access-token" },
    { label: "mock refresh token", value: "fake-refresh-token" },
    { label: "mock verifier", value: "mock-verifier" },
    { label: "mock auth code", value: "mock-code-smoke" },
    { label: "Codex-like access token", value: "codex-smoke-access-token-secret" },
    { label: "Codex-like refresh token", value: "codex-smoke-refresh-token-secret" },
    { label: "Codex-like auth code", value: "codex-code-smoke-secret" },
    { label: "Codex-like failed auth code", value: "codex-code-smoke-failure-secret" },
    { label: "Codex-like transient callback auth code", value: "codex-code-smoke-transient-secret" },
    { label: "Codex-like invalid_grant auth code", value: "codex-code-smoke-invalid-grant-secret" },
    { label: "Codex-like missing-expiry auth code", value: "codex-code-smoke-missing-expiry-secret" },
    { label: "Codex-like zero-expiry auth code", value: "codex-code-smoke-zero-expiry-secret" },
    { label: "Codex-like negative-expiry auth code", value: "codex-code-smoke-negative-expiry-secret" },
    { label: "Codex-like oversized-expiry auth code", value: "codex-code-smoke-oversized-expiry-secret" },
    { label: "Codex-like negative-expiry access token", value: "codex-smoke-negative-expiry-access-secret" },
    { label: "Codex-like negative-expiry refresh token", value: "codex-smoke-negative-expiry-refresh-secret" },
    { label: "Codex-like oversized-expiry access token", value: "codex-smoke-oversized-expiry-access-secret" },
    { label: "Codex-like oversized-expiry refresh token", value: "codex-smoke-oversized-expiry-refresh-secret" },
    { label: "Codex-like transient provider body", value: "temporary callback provider detail" },
    { label: "Codex-like invalid_grant provider description", value: "authorization code was already used" },
    { label: "Codex-like PKCE verifier", value: parsedCodexTokenBody.code_verifier },
    { label: "authorization header marker", value: "authorization: bearer" },
    { label: "Codex-like bearer marker", value: "bearer codex-smoke-access-token-secret" },
    { label: "active editor selection context", value: activeContextSelection },
    { label: "cookie marker", value: "cookie" },
    { label: "auth file marker", value: "auth.json" },
    { label: "Codex auth file marker", value: ".codex/auth.json" },
    { label: "client secret marker", value: "client_secret" },
    { label: "authorization code marker", value: "authorization_code" }
  ];
  const logSecretMarkers = [
    ...secretMarkers,
    { label: "Codex-like session id", value: codexStart.sessionId },
    { label: "Codex-like state", value: codexState },
    { label: "Codex-like restart session id", value: codexRestart.sessionId },
    { label: "Codex-like restart state", value: codexRestartState },
    { label: "Codex-like terminal session id", value: codexTerminalStart.sessionId },
    { label: "Codex-like terminal state", value: codexTerminalState },
    { label: "Codex-like challenge", value: codexChallenge }
  ];
  const engineOutput = await readFile(engine.logPath, "utf8");
  assert(engineOutput.includes("provider_auth.exchange_failed"), "engine log omitted provider-auth exchange failure event");
  assert(engineOutput.includes("stage=callback"), "engine log omitted callback exchange stage");
  assert(engineOutput.includes("category=token_http_status_502"), "engine log omitted transient callback HTTP category");
  assert(engineOutput.includes("category=token_http_status_400"), "engine log omitted terminal callback HTTP category");
  assert(engineOutput.includes("category=expires_invalid"), "engine log omitted invalid expiry category");
  assert(engineOutput.includes("endpoint_class=loopback_override"), "engine log omitted loopback endpoint class");
  assert(engineOutput.includes("detail=http_status=400;_oauth_error=invalid_grant"), "engine log omitted canonical terminal detail");
  assertNoSecretLeak(clientVisible, secretMarkers);
  assertNoSecretLeak(engineOutput, logSecretMarkers);

  console.log("Local smoke test passed.");
} finally {
  if (engine) {
    await stopProcess(engine);
  }
  if (mockProvider) {
    await closeServer(mockProvider.server);
  }
  if (mockCodexTokenEndpoint) {
    await closeServer(mockCodexTokenEndpoint.server);
  }
  if (mockCodexChatEndpoint) {
    await closeServer(mockCodexChatEndpoint.server);
  }
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
  }
}

async function verifyCodexFallbackExpiry(baseUrl, expiryKind) {
  const code = `codex-code-smoke-${expiryKind}-expiry-secret`;
  const start = await requestJson(baseUrl, "/v1/provider-auth/openai/start", {
    method: "POST",
    body: JSON.stringify({
      experimentalCodexLike: true,
      tokenEndpointUrl: mockCodexTokenEndpoint.url,
      chatEndpointUrl: mockCodexChatEndpoint.baseUrl
    })
  });
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  const earliestExpiry = Date.now() + (8 * 24 * 60 * 60 * 1_000) - 10_000;
  const callback = await requestCallback(start.authorizationUrl, code);
  const latestExpiry = Date.now() + (8 * 24 * 60 * 60 * 1_000) + 10_000;
  assert(callback.status === 200, `experimental Codex-like ${expiryKind} expiry callback did not succeed`);
  assertNoSecretLeak(callback.raw, [
    { label: `Codex-like ${expiryKind} expiry auth code`, value: code },
    { label: `Codex-like ${expiryKind} expiry state`, value: state },
    { label: "Codex-like access token", value: "codex-smoke-access-token-secret" },
    { label: "Codex-like refresh token", value: "codex-smoke-refresh-token-secret" }
  ]);
  const connected = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(connected.configured === true, `experimental Codex-like ${expiryKind} expiry was not configured`);
  assert(connected.status === "connected", `experimental Codex-like ${expiryKind} expiry was not connected`);
  assert(connected.authSource === "oauth", `experimental Codex-like ${expiryKind} expiry did not use OAuth`);
  const expiresAt = Date.parse(connected.expiresAt);
  assert(Number.isFinite(expiresAt), `experimental Codex-like ${expiryKind} expiry returned invalid expiry`);
  assert(expiresAt >= earliestExpiry, `experimental Codex-like ${expiryKind} expiry fell below fallback bound`);
  assert(expiresAt <= latestExpiry, `experimental Codex-like ${expiryKind} expiry exceeded fallback bound`);
  const disconnect = await requestJson(baseUrl, "/v1/provider-auth/openai/disconnect", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert(disconnect.status === "api_key_configured", `experimental Codex-like ${expiryKind} expiry cleanup lost API-key fallback`);
  return { callback, connected, disconnect };
}

async function verifyCodexInvalidExpiry(baseUrl, home, expiryKind) {
  const code = `codex-code-smoke-${expiryKind}-expiry-secret`;
  const accessToken = `codex-smoke-${expiryKind}-expiry-access-secret`;
  const refreshToken = `codex-smoke-${expiryKind}-expiry-refresh-secret`;
  const fallbackBefore = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(fallbackBefore.status === "api_key_configured", `experimental Codex-like ${expiryKind} expiry setup lacked API-key fallback`);
  const start = await requestJson(baseUrl, "/v1/provider-auth/openai/start", {
    method: "POST",
    body: JSON.stringify({
      experimentalCodexLike: true,
      tokenEndpointUrl: mockCodexTokenEndpoint.url,
      chatEndpointUrl: mockCodexChatEndpoint.baseUrl
    })
  });
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  const callback = await requestCallback(start.authorizationUrl, code);
  assert(callback.status === 502, `experimental Codex-like ${expiryKind} expiry callback did not fail safely`);
  assert(callback.body.includes("retry login or the authorization code"), `experimental Codex-like ${expiryKind} expiry callback omitted safe retry text`);
  assertNoSecretLeak(callback.raw, [
    { label: `Codex-like ${expiryKind} expiry auth code`, value: code },
    { label: `Codex-like ${expiryKind} expiry state`, value: state },
    { label: `Codex-like ${expiryKind} expiry access token`, value: accessToken },
    { label: `Codex-like ${expiryKind} expiry refresh token`, value: refreshToken },
    { label: "private path marker", value: home }
  ]);
  const pending = await requestJson(baseUrl, "/v1/provider-auth/openai/status");
  assert(pending.configured === false, `experimental Codex-like ${expiryKind} expiry unexpectedly configured OAuth`);
  assert(pending.status === "pending", `experimental Codex-like ${expiryKind} expiry did not preserve pending state`);
  assert(pending.lastError?.includes("expires_invalid"), `experimental Codex-like ${expiryKind} expiry omitted sanitized category`);
  assertNoSecretLeak(JSON.stringify(pending), [
    { label: `Codex-like ${expiryKind} expiry auth code`, value: code },
    { label: `Codex-like ${expiryKind} expiry access token`, value: accessToken },
    { label: `Codex-like ${expiryKind} expiry refresh token`, value: refreshToken }
  ]);
  const disconnect = await requestJson(baseUrl, "/v1/provider-auth/openai/disconnect", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert(disconnect.status === "api_key_configured", `experimental Codex-like ${expiryKind} expiry mutated stored fallback status`);
  assert(disconnect.authSource === "api_key", `experimental Codex-like ${expiryKind} expiry mutated stored fallback auth source`);
  assert(disconnect.redacted === fallbackBefore.redacted, `experimental Codex-like ${expiryKind} expiry mutated stored fallback secret hint`);
  return { callback, pending, disconnect };
}

async function makeTempHome() {
  const home = path.join(os.tmpdir(), `yet-ai-smoke-${process.pid}-${Date.now()}`);
  await mkdir(path.join(home, "Library", "Application Support"), { recursive: true });
  await mkdir(path.join(home, ".config"), { recursive: true });
  await mkdir(path.join(home, ".cache"), { recursive: true });
  await mkdir(path.join(home, "logs"), { recursive: true });
  return home;
}

function startEngine(port, callbackPort, home) {
  const child = spawn("cargo", ["run", "-p", "yet-lsp", "--quiet"], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      CARGO_HOME: process.env.CARGO_HOME ?? path.join(process.env.HOME ?? home, ".cargo"),
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(process.env.HOME ?? home, ".rustup"),
      NO_PROXY: appendNoProxy(process.env.NO_PROXY),
      no_proxy: appendNoProxy(process.env.no_proxy),
      YET_AI_AUTH_TOKEN: token,
      YET_AI_HTTP_PORT: String(port),
      YET_AI_PROVIDER_AUTH_CALLBACK_PORT: String(callbackPort),
      YET_AI_LOG_DIR: path.join(home, "logs")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.output = () => output;
  child.logPath = path.join(home, "logs", `engine-${port}.log`);
  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`Engine exited with code ${code}.`);
    } else if (signal && signal !== "SIGTERM") {
      console.error(`Engine exited with signal ${signal}.`);
    }
  });
  return child;
}

async function waitForEngine(baseUrl) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (engine.exitCode !== null) {
      throw new Error(`Engine exited before becoming ready.\n${engine.output()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/v1/ping`, { headers: authHeaders() });
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {
    }
    await delay(250);
  }
  throw new Error(`Engine did not become ready within ${timeoutMs}ms.\n${engine.output()}`);
}

async function startMockProvider() {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    providerAuth = request.headers.authorization;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      providerRequestBody += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache"
      });
      response.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"content":" smoke"}}]}\n\n');
      response.end("data: [DONE]\n\n");
    });
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function startMockCodexTokenEndpoint() {
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/backend-api/codex/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "gpt-5-codex" }] }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/oauth/token") {
      response.writeHead(404).end();
      return;
    }
    codexTokenRequestCount += 1;
    request.setEncoding("utf8");
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      codexTokenRequestBody += `${body}\n`;
      const code = parseFormBody(body).code;
      if (code === "codex-code-smoke-missing-expiry-secret") {
        respondWithCodexToken(response);
        return;
      }
      if (code === "codex-code-smoke-zero-expiry-secret") {
        respondWithCodexToken(response, { expires_in: 0 });
        return;
      }
      if (code === "codex-code-smoke-negative-expiry-secret") {
        respondWithCodexToken(response, {
          access_token: "codex-smoke-negative-expiry-access-secret",
          refresh_token: "codex-smoke-negative-expiry-refresh-secret",
          expires_in: -1
        });
        return;
      }
      if (code === "codex-code-smoke-oversized-expiry-secret") {
        respondWithCodexToken(response, {
          access_token: "codex-smoke-oversized-expiry-access-secret",
          refresh_token: "codex-smoke-oversized-expiry-refresh-secret",
          expires_in: 86401
        });
        return;
      }
      if (codexTokenRequestCount === 1) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "temporary failure" }));
        return;
      }
      if (codexTokenRequestCount === 3) {
        response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({
          error: "server_error",
          error_description: "temporary callback provider detail"
        }));
        return;
      }
      if (codexTokenRequestCount === 5) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({
          error: "invalid_grant",
          error_description: "authorization code was already used"
        }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        access_token: "codex-smoke-access-token-secret",
        refresh_token: "codex-smoke-refresh-token-secret",
        id_token: fakeCodexIdToken(),
        expires_in: 1800,
        scope: "openid profile email offline_access",
        account_label: "smoke-user@example.test"
      }));
    });
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/oauth/token` };
}

async function startMockCodexChatEndpoint() {
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url?.startsWith("/models")) {
      codexChatAuth = request.headers.authorization;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "gpt-5-codex" }] }));
      return;
    }
    if (request.method !== "POST" || !["/responses", "/chat/completions", "/v1/chat/completions"].includes(request.url)) {
      response.writeHead(404).end();
      return;
    }
    codexChatRequestCount += 1;
    codexChatAuth = request.headers.authorization;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      codexChatRequestBody += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache"
      });
      response.write('data: {"type":"response.output_text.delta","delta":"OAuth"}\n\n');
      response.write('data: {"type":"response.output_text.delta","delta":" smoke"}\n\n');
      response.end('data: {"type":"response.completed"}\n\n');
    });
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function fakeCodexIdToken() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ chatgpt_account_id: "account-smoke" })}.signature`;
}

function respondWithCodexToken(response, overrides = {}) {
  const token = {
    access_token: "codex-smoke-access-token-secret",
    refresh_token: "codex-smoke-refresh-token-secret",
    id_token: fakeCodexIdToken(),
    scope: "openid profile email offline_access",
    account_label: "smoke-user@example.test",
    ...overrides
  };
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(token));
}

function parseFormBody(body) {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

async function requestJson(baseUrl, route, init = {}) {
  const { expectedStatus, ...fetchInit } = init;
  const response = await fetch(`${baseUrl}${route}`, {
    ...fetchInit,
    headers: {
      ...authHeaders(),
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    }
  });
  const text = await response.text();
  if (expectedStatus === undefined ? !response.ok : response.status !== expectedStatus) {
    throw new Error(`Request ${route} returned unexpected HTTP status ${response.status}`);
  }
  return JSON.parse(text);
}

async function requestEmpty(baseUrl, route, init = {}) {
  const { expectedStatus, ...fetchInit } = init;
  const response = await fetch(`${baseUrl}${route}`, {
    ...fetchInit,
    headers: {
      ...authHeaders(),
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    }
  });
  if (response.status !== expectedStatus) {
    throw new Error(`Request ${route} returned unexpected HTTP status ${response.status}`);
  }
  await response.arrayBuffer();
}

async function requestCallback(authorizationUrl, code) {
  const authorizeUrl = new URL(authorizationUrl);
  const callbackUrl = new URL(authorizeUrl.searchParams.get("redirect_uri"));
  const state = authorizeUrl.searchParams.get("state");
  callbackUrl.searchParams.set("code", code);
  callbackUrl.searchParams.set("scope", "openid profile email offline_access");
  callbackUrl.searchParams.set("state", state);
  const response = await fetch(callbackUrl, {
    headers: { Accept: "text/html" }
  });
  const body = await response.text();
  return {
    status: response.status,
    body,
    raw: JSON.stringify({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body
    })
  };
}

async function readSnapshot(baseUrl, id) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/v1/chats/subscribe?chat_id=${encodeURIComponent(id)}`, {
    headers: { ...authHeaders(), Accept: "text/event-stream" },
    signal: controller.signal
  });
  if (!response.ok || !response.body) {
    throw new Error(`SSE snapshot subscribe failed with HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let buffer = "";
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      const read = await Promise.race([
        reader.read(),
        delay(1_000).then(() => ({ timeout: true }))
      ]);
      if (read.timeout) {
        continue;
      }
      if (read.done) {
        break;
      }
      const chunk = decoder.decode(read.value, { stream: true });
      raw += chunk;
      buffer += chunk;
      const drained = drainSseFrames(buffer);
      buffer = drained.rest;
      for (const frame of drained.frames) {
        const event = parseSseFrame(frame);
        if (event?.type === "snapshot") {
          return event;
        }
      }
    }
  } finally {
    controller.abort();
    reader.releaseLock();
  }
  throw new Error(`SSE snapshot was not received within ${timeoutMs}ms. Raw: ${raw}`);
}

async function subscribe(baseUrl, id, options = {}) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/v1/chats/subscribe?chat_id=${encodeURIComponent(id)}`, {
    headers: { ...authHeaders(), Accept: "text/event-stream" },
    signal: controller.signal
  });
  if (!response.ok || !response.body) {
    throw new Error(`SSE subscribe failed with HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let raw = "";
  let buffer = "";
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      const read = await Promise.race([
        reader.read(),
        delay(1_000).then(() => ({ timeout: true }))
      ]);
      if (read.timeout) {
        continue;
      }
      if (read.done) {
        break;
      }
      const chunk = decoder.decode(read.value, { stream: true });
      raw += chunk;
      buffer += chunk;
      const drained = drainSseFrames(buffer);
      buffer = drained.rest;
      for (const frame of drained.frames) {
        const event = parseSseFrame(frame);
        if (event) {
          events.push(event);
          if (event.type === "stream_finished" || (options.finishOnError && event.type === "error")) {
            controller.abort();
            return { events, raw };
          }
        }
      }
    }
  } finally {
    controller.abort();
    reader.releaseLock();
  }
  throw new Error(`SSE stream did not finish within ${timeoutMs}ms. Events: ${JSON.stringify(events)}`);
}

function parseSseFrame(frame) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  if (data.length === 0) {
    return null;
  }
  return JSON.parse(data.join("\n"));
}

function drainSseFrames(buffer) {
  const parts = buffer.split(/\r?\n\r?\n/);
  return { frames: parts.slice(0, -1).filter((part) => part.trim() !== ""), rest: parts.at(-1) ?? "" };
}

function assertMonotonicSequence(events) {
  let expected = null;
  for (const event of events) {
    if (event.type === "snapshot") {
      expected = 1;
      continue;
    }
    if (expected !== null) {
      assert(event.seq === expected, `SSE sequence gap: expected ${expected}, received ${event.seq}`);
      expected += 1;
    }
  }
}

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

function sanitizedProviderAuthStatus(response) {
  return {
    provider: response?.provider,
    configured: response?.configured,
    status: response?.status,
    authSource: response?.authSource,
    supportsLogin: response?.supportsLogin,
    supportsApiKey: response?.supportsApiKey,
    cloudRequired: response?.cloudRequired,
    success: response?.success
  };
}

function appendNoProxy(value) {
  const entries = new Set(
    String(value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  for (const entry of ["127.0.0.1", "localhost", "::1"]) {
    entries.add(entry);
  }
  return [...entries].join(",");
}

function assertNoSecretLeak(text, markers) {
  const lower = text.toLowerCase();
  for (const marker of markers) {
    if (!marker?.value) {
      continue;
    }
    assert(!lower.includes(String(marker.value).toLowerCase()), `secret marker leaked to client-visible output: ${marker.label}`);
  }
}

async function freePort() {
  const server = net.createServer();
  await listen(server, "127.0.0.1", 0);
  const address = server.address();
  const port = address.port;
  await closeServer(server);
  return port;
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000).then(() => false)
  ]);
  if (exited === false) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
