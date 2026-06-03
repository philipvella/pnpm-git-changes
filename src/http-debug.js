function resolveUrl(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return String(input);
}

function formatMethod(method) {
  return (method || 'GET').toUpperCase();
}

export function logHttpRequestStart(client, method, url) {
  console.log(`[http:${client}] -> ${formatMethod(method)} ${url}`);
}

export function logHttpRequestSuccess(client, method, url, status, durationMs) {
  console.log(`[http:${client}] <- ${formatMethod(method)} ${url} (${status}, ${durationMs}ms)`);
}

export function logHttpRequestError(client, method, url, durationMs, errorMessage) {
  console.log(`[http:${client}] !! ${formatMethod(method)} ${url} (${durationMs}ms) ${errorMessage}`);
}

export function createDebugFetch(client) {
  return async function debugFetch(input, init = {}) {
    const method = init.method || 'GET';
    const url = resolveUrl(input);
    const start = Date.now();

    logHttpRequestStart(client, method, url);

    try {
      const response = await fetch(input, init);
      logHttpRequestSuccess(client, method, url, response.status, Date.now() - start);
      return response;
    } catch (error) {
      logHttpRequestError(client, method, url, Date.now() - start, error.message);
      throw error;
    }
  };
}

