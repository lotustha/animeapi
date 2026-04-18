import { SERVER_ORIGIN } from "./config.js";

export const proxifySource = (url: string, headers?: Record<string, string> | undefined) => {
  const urlParam = `?url=` + encodeURIComponent(url);
  const headerParam = headers ? `&headers=` + encodeURIComponent(JSON.stringify(headers)) : "";
  if (url.includes(".m3u")) {
    // count as hls source
    return SERVER_ORIGIN + "/proxy/m3u8-proxy" + urlParam + headerParam;
  } else {
    // count as mp4
    return SERVER_ORIGIN + "/proxy/mp4-proxy" + urlParam + headerParam;
  }
};
