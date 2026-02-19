/**
 * tests/notify.test.ts — Unit tests for notify.ts
 *
 * Tests parseTelegramTarget() (via the exported notifyUser + internal path)
 * and the notifyUser() fire-and-forget behavior.
 *
 * parseTelegramTarget is not directly exported, so we test it indirectly
 * through notifyUser() by observing what chatId/threadId values reach
 * the mock sendMessageTelegram function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setRuntime, notifyUser } from '../src/notify';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a mock runtime with a spy on sendMessageTelegram.
 * Returns the runtime object and the spy so tests can assert on call args.
 */
function buildMockRuntime() {
  const sendMessageTelegram = vi.fn().mockResolvedValue(undefined);
  const runtime = {
    channel: {
      telegram: {
        sendMessageTelegram,
      },
    },
  };
  return { runtime, sendMessageTelegram };
}

/** Flush all pending microtasks (allows fire-and-forget Promises to settle). */
async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset runtime before each test so tests are isolated
  setRuntime(null);
});

afterEach(() => {
  setRuntime(null);
  vi.restoreAllMocks();
});

// ─── parseTelegramTarget — tested via notifyUser() ────────────────────────────

describe('parseTelegramTarget (via notifyUser)', () => {

  it('forum topic key → sends to correct chatId and threadId', async () => {
    const { runtime, sendMessageTelegram } = buildMockRuntime();
    setRuntime(runtime);

    notifyUser('agent:main:telegram:group:-100EXAMPLE456789:topic:42', 'test message');
    await flushPromises();

    expect(sendMessageTelegram).toHaveBeenCalledOnce();
    expect(sendMessageTelegram).toHaveBeenCalledWith(
      '-100EXAMPLE456789',
      'test message',
      { messageThreadId: 42 }
    );
  });

  it('group key (no topic) → sends to chatId only, no threadId', async () => {
    const { runtime, sendMessageTelegram } = buildMockRuntime();
    setRuntime(runtime);

    notifyUser('agent:main:telegram:group:-100EXAMPLE987', 'group message');
    await flushPromises();

    expect(sendMessageTelegram).toHaveBeenCalledOnce();
    expect(sendMessageTelegram).toHaveBeenCalledWith(
      '-100EXAMPLE987',
      'group message',
      {} // no messageThreadId
    );
  });

  it('DM key → sends to DM chatId, no threadId', async () => {
    const { runtime, sendMessageTelegram } = buildMockRuntime();
    setRuntime(runtime);

    notifyUser('telegram:123456789', 'dm message');
    await flushPromises();

    expect(sendMessageTelegram).toHaveBeenCalledOnce();
    expect(sendMessageTelegram).toHaveBeenCalledWith(
      '123456789',
      'dm message',
      {} // no messageThreadId
    );
  });

  it('non-Telegram session key → no send (silently skipped)', async () => {
    const { runtime, sendMessageTelegram } = buildMockRuntime();
    setRuntime(runtime);

    notifyUser('agent:main:subagent:abc123', 'should not be sent');
    await flushPromises();

    expect(sendMessageTelegram).not.toHaveBeenCalled();
  });

  it('empty session key → no send', async () => {
    const { runtime, sendMessageTelegram } = buildMockRuntime();
    setRuntime(runtime);

    notifyUser('', 'should not be sent');
    await flushPromises();

    expect(sendMessageTelegram).not.toHaveBeenCalled();
  });

  it('topic threadId is parsed as integer (not string)', async () => {
    const { runtime, sendMessageTelegram } = buildMockRuntime();
    setRuntime(runtime);

    notifyUser('agent:main:telegram:group:-100EXAMPLE:topic:42', 'check type');
    await flushPromises();

    const opts = sendMessageTelegram.mock.calls[0]![2];
    expect(typeof opts.messageThreadId).toBe('number');
    expect(opts.messageThreadId).toBe(42);
  });

  it('topic key correctly prefers topic match over group match', async () => {
    const { runtime, sendMessageTelegram } = buildMockRuntime();
    setRuntime(runtime);

    // This key has both group and topic patterns — topic should win
    notifyUser('telegram:group:-100EXAMPLE555:topic:99', 'precedence test');
    await flushPromises();

    expect(sendMessageTelegram).toHaveBeenCalledWith(
      '-100EXAMPLE555',
      'precedence test',
      { messageThreadId: 99 }
    );
  });

});

// ─── notifyUser — fire-and-forget behavior ────────────────────────────────────

describe('notifyUser fire-and-forget behavior', () => {

  it('returns undefined synchronously (does not return a Promise)', () => {
    const { runtime } = buildMockRuntime();
    setRuntime(runtime);

    const result = notifyUser('telegram:group:-100EXAMPLE:topic:1', 'sync test');
    // notifyUser() returns void (undefined), not a Promise
    expect(result).toBeUndefined();
  });

  it('no-ops silently when runtime is not set', async () => {
    // setRuntime(null) was called in beforeEach — runtime is unset
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    notifyUser('telegram:group:-100EXAMPLE:topic:1', 'no runtime');
    await flushPromises();

    // Should log a warning, not throw
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Runtime not set')
    );
  });

  it('no-ops silently when sendMessageTelegram is not available', async () => {
    const runtimeWithoutSend = {
      channel: {
        telegram: {
          // sendMessageTelegram is missing
        },
      },
    };
    setRuntime(runtimeWithoutSend);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    notifyUser('telegram:group:-100EXAMPLE:topic:1', 'no send fn');
    await flushPromises();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('sendMessageTelegram not available')
    );
  });

  it('catches and logs errors from sendMessageTelegram without throwing', async () => {
    const { runtime } = buildMockRuntime();
    // Make send throw
    runtime.channel.telegram.sendMessageTelegram.mockRejectedValue(new Error('network error'));
    setRuntime(runtime);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Should not throw, not reject
    notifyUser('telegram:group:-100EXAMPLE:topic:1', 'failing send');
    await flushPromises();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('network error')
    );
  });

  it('sends the full message text unmodified', async () => {
    const { runtime, sendMessageTelegram } = buildMockRuntime();
    setRuntime(runtime);

    const msg = '🚫 Blocked: Use `trash` instead of `rm`. Very long message that should pass through fully.';
    notifyUser('telegram:group:-100EXAMPLE:topic:1', msg);
    await flushPromises();

    expect(sendMessageTelegram).toHaveBeenCalledWith(
      expect.any(String),
      msg,
      expect.any(Object)
    );
  });

});

// ─── Integration: notifyUser called from engine block path ───────────────────

describe('notifyUser integration with engine block', () => {

  it('notifyUser is called when engine.execute() blocks with notifyUser: true', async () => {
    const { runtime, sendMessageTelegram } = buildMockRuntime();
    setRuntime(runtime);

    // Import engine here so setRuntime above takes effect
    const { LifecycleGateEngine } = await import('../src/engine');

    const engine = new LifecycleGateEngine();
    // Inject config directly
    (engine as unknown as { config: unknown }).config = {
      version: '1',
      hooks: [
        {
          point: 'turn:tool:pre',
          action: 'block',
          onFailure: {
            action: 'block',
            notifyUser: true,
            message: '🚫 rm is blocked by hook',
          },
        },
      ],
    };

    const results = await engine.execute('turn:tool:pre', {
      point: 'turn:tool:pre',
      sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
      toolName: 'exec',
      toolArgs: { command: 'rm /tmp/file.txt' },
      timestamp: Date.now(),
    });

    // Hook should have blocked
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.message).toBe('🚫 rm is blocked by hook');

    // Give fire-and-forget time to settle
    await flushPromises();

    // Telegram notification should have been sent
    expect(sendMessageTelegram).toHaveBeenCalledOnce();
    expect(sendMessageTelegram).toHaveBeenCalledWith(
      '-100EXAMPLE',
      '🚫 rm is blocked by hook',
      { messageThreadId: 42 }
    );
  });

  it('notifyUser is NOT called when notifyUser: false (default)', async () => {
    const { runtime, sendMessageTelegram } = buildMockRuntime();
    setRuntime(runtime);

    const { LifecycleGateEngine } = await import('../src/engine');

    const engine = new LifecycleGateEngine();
    (engine as unknown as { config: unknown }).config = {
      version: '1',
      hooks: [
        {
          point: 'turn:tool:pre',
          action: 'block',
          onFailure: {
            action: 'block',
            notifyUser: false,  // ← explicitly false
            message: 'blocked quietly',
          },
        },
      ],
    };

    const results = await engine.execute('turn:tool:pre', {
      point: 'turn:tool:pre',
      sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:42',
      toolName: 'exec',
      toolArgs: { command: 'rm /tmp/file.txt' },
      timestamp: Date.now(),
    });

    expect(results[0]!.passed).toBe(false);
    await flushPromises();

    // No notification should be sent
    expect(sendMessageTelegram).not.toHaveBeenCalled();
  });

  it('onFailure.action notify → calls notifyUser and returns passed=true', async () => {
    const { runtime, sendMessageTelegram } = buildMockRuntime();
    setRuntime(runtime);

    const { LifecycleGateEngine } = await import('../src/engine');

    const engine = new LifecycleGateEngine();
    (engine as unknown as { config: unknown }).config = {
      version: '1',
      hooks: [
        {
          point: 'turn:pre',
          // Custom action path that fails to load → triggers onFailure
          action: '/nonexistent/action.js',
          onFailure: {
            action: 'notify',
            message: 'Action failed, notifying user',
          },
        },
      ],
    };

    const results = await engine.execute('turn:pre', {
      point: 'turn:pre',
      sessionKey: 'agent:main:telegram:group:-100EXAMPLE:topic:99',
      timestamp: Date.now(),
    });

    // notify action → passed=true (continues pipeline)
    expect(results[0]!.passed).toBe(true);
    await flushPromises();

    expect(sendMessageTelegram).toHaveBeenCalledOnce();
    expect(sendMessageTelegram).toHaveBeenCalledWith(
      '-100EXAMPLE',
      'Action failed, notifying user',
      { messageThreadId: 99 }
    );
  });

});
