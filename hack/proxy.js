#!/usr/bin/env deno run --allow-net --watch -A

//
// A little Deno proxy to re-host the UO API and inject CORS headers
//

const BASE_URL = "https://api.usb.urbanobservatory.ac.uk/";

const cache = Deno.args.includes("--cache") ? await caches.open("v1") : null;

Deno.serve({ port: 8080 }, async (request) => {
  const { pathname, search } = new URL(request.url);
  const url = new URL("." + pathname, BASE_URL);
  url.search = search;

  const cached = await cache?.match(request);
  if (cached) {
    console.debug("CACHED %s: %o", request.method, pathname);
    return cached;
  }

  console.debug("%s: %o", request.method, pathname);

  const headers = new Headers(request.headers);
  headers.set("Host", url.hostname);

  const res = await fetch(url, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
    mode: "no-cors",
  });

  const fakeHeaders = new Headers(res.headers);
  fakeHeaders.set("Access-Control-Allow-Origin", "http://localhost:5173");

  const proxyRes = new Response(res.body, {
    headers: fakeHeaders,
  });
  if (cache && res.ok) {
    cache.put(request, proxyRes.clone());
  }
  return proxyRes;
});
