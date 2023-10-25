#!/usr/bin/env deno run --allow-net --watch

//
// A little Deno proxy to re-host the UO API and inject CORS headers
//

const BASE_URL = "https://api.usb.urbanobservatory.ac.uk/";

Deno.serve({ port: 8080 }, async (request) => {
  const { pathname, search } = new URL(request.url);
  const url = new URL("." + pathname, BASE_URL);
  url.search = search;

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

  return new Response(res.body, {
    headers: fakeHeaders,
  });
});
