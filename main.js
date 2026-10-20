const {
  core,
  console,
  event,
  http,
  menu,
  preferences,
  subtitle,
  utils,
} = iina;

require("./core.js");
const hub = (typeof globalThis !== "undefined" && globalThis.CNSubtitleHubCore) ||
  (typeof global !== "undefined" && global.CNSubtitleHubCore);
const PROVIDER_ID = "cn-subtitle-hub";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
let zimukuProblem = "";

function getPreference(key, fallback) {
  const value = preferences.get(key);
  return value === undefined || value === null || value === "" ? fallback : value;
}

function boolPreference(key, fallback) {
  const value = getPreference(key, fallback);
  return value === true || value === "true" || value === 1 || value === "1";
}

function currentVideoName() {
  const url = core.status.url || "";
  const title = core.status.title || "";
  const decoded = decodeURIComponent(String(url || title));
  return hub.stripVideoExtension(decoded.split(/[\\/]/).pop() || title || "video");
}

function currentVideoPath() {
  return hub.decodeFileUrl(core.status.url || "");
}

async function curlText(args, errorMessage) {
  const response = await utils.exec("/usr/bin/curl", args);
  if (response.status !== 0) {
    throw new Error(response.stderr || errorMessage || "网络请求失败");
  }
  return response.stdout || "";
}

async function computeXunleiCid(videoPath) {
  const result = await utils.exec("/bin/sh", [
    "-c",
    [
      "size=$(/usr/bin/stat -f%z \"$1\") || exit 1",
      "[ \"$size\" -ge 61440 ] || exit 2",
      "p1=$((size / 3))",
      "p2=$((size - 20480))",
      "{",
      "  /bin/dd if=\"$1\" bs=1 skip=0 count=20480 2>/dev/null",
      "  /bin/dd if=\"$1\" bs=1 skip=\"$p1\" count=20480 2>/dev/null",
      "  /bin/dd if=\"$1\" bs=1 skip=\"$p2\" count=20480 2>/dev/null",
      "} | /usr/bin/shasum -a 1 | /usr/bin/awk '{print toupper($1)}'",
    ].join("\n"),
    "xunlei-cid",
    videoPath,
  ]);
  return result.status === 0 ? (result.stdout || "").trim() : "";
}

async function computeShooterHash(videoPath) {
  const result = await utils.exec("/bin/sh", [
    "-c",
    [
      "size=$(/usr/bin/stat -f%z \"$1\") || exit 1",
      "[ \"$size\" -ge 61440 ] || exit 2",
      "positions=\"4096 $((size * 2 / 3)) $((size / 3)) $((size - 8192))\"",
      "hashes=\"\"",
      "for position in $positions; do",
      "  hash=$(/bin/dd if=\"$1\" bs=1 skip=\"$position\" count=4096 2>/dev/null | /sbin/md5 -q) || exit 3",
      "  if [ -n \"$hashes\" ]; then hashes=\"$hashes;$hash\"; else hashes=\"$hash\"; fi",
      "done",
      "printf '%s\\n' \"$hashes\"",
    ].join("\n"),
    "shooter-hash",
    videoPath,
  ]);
  return result.status === 0 ? (result.stdout || "").trim() : "";
}

async function getText(url, params) {
  const response = await http.get(url, {
    params: params || {},
    headers: {
      "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
      "User-Agent": USER_AGENT,
    },
  });
  return response.text || "";
}

async function getJson(url, params) {
  const text = await getText(url, params);
  if (!text) return null;
  return JSON.parse(text);
}

function searchWithDeadline(label, promise, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.log(`${label} search timed out after ${timeoutMs}ms`);
      resolve([]);
    }, timeoutMs);

    promise.then((items) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(items || []);
    }).catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.log(`${label} search failed: ${err}`);
      resolve([]);
    });
  });
}

async function searchAssrt(videoName) {
  if (!boolPreference("assrt_enabled", true)) return [];
  const token = getPreference("assrt_token", "");
  if (!token) return [];

  const json = await getJson("https://api.assrt.net/v1/sub/search", {
    token,
    q: hub.titleQuery(videoName),
    cnt: "15",
    pos: "0",
    no_muxer: "1",
  });

  if (!json || json.status !== 0) {
    console.log(`ASSRT search skipped: ${json ? json.errmsg : "empty response"}`);
    return [];
  }

  const subs = json.sub && Array.isArray(json.sub.subs) ? json.sub.subs : [];
  return subs.map((item) => hub.mapAssrtSearchItem(item, videoName));
}

async function searchSubtitleCat(videoName) {
  if (!boolPreference("subtitlecat_enabled", true)) return [];

  const queries = hub.searchQueries(videoName);

  const pages = await Promise.all(queries.map((query) => {
    return getText("https://www.subtitlecat.com/index.php", { search: query }).catch(() => "");
  }));
  const all = [];
  pages.forEach((html) => {
    hub.parseSubtitleCatSearch(html, videoName).forEach((item) => all.push(item));
  });
  return hub.rankResults(all, videoName).slice(0, 10);
}

async function searchSubhd(videoName) {
  if (!boolPreference("subhd_enabled", true)) return [];
  const queries = hub.searchQueries(videoName);
  if (!queries.length) return [];

  const pages = await Promise.all(queries.map((query) => curlText([
    "--http2",
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    "--connect-timeout", "5",
    "--max-time", "12",
    "-A", USER_AGENT,
    "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.6",
    `https://subhd.tv/search/${encodeURIComponent(query)}`,
  ], "SubHD 搜索失败").catch(() => "")));
  let results = [];
  pages.forEach((html) => { results = results.concat(hub.parseSubhdSearch(html, videoName)); });
  return hub.rankResults(results, videoName).slice(0, 20);
}

async function searchXunlei(videoName) {
  if (!boolPreference("xunlei_enabled", true)) return [];
  const videoPath = currentVideoPath();
  if (!videoPath) return [];

  const cid = await computeXunleiCid(videoPath);
  if (!cid) return [];
  const text = await curlText([
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    "--connect-timeout", "5",
    "--max-time", "12",
    "-A", USER_AGENT,
    `http://sub.xmp.sandai.net:8000/subxl/${cid}.json`,
  ], "迅雷字幕搜索失败");

  try {
    return hub.rankResults(hub.mapXunleiResults(JSON.parse(text), videoName), videoName).slice(0, 10);
  } catch (_) {
    return [];
  }
}

async function searchShooter(videoName) {
  if (!boolPreference("shooter_enabled", true)) return [];
  const videoPath = currentVideoPath();
  if (!videoPath) return [];

  const fileHash = await computeShooterHash(videoPath);
  if (!fileHash) return [];
  const text = await curlText([
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    "--connect-timeout", "5",
    "--max-time", "12",
    "-A", USER_AGENT,
    "-X", "POST",
    "https://www.shooter.cn/api/subapi.php",
    "--data-urlencode", `filehash=${fileHash}`,
    "--data-urlencode", `pathinfo=${videoName}`,
    "--data-urlencode", "format=json",
    "--data-urlencode", "lang=Chn",
  ], "射手字幕搜索失败");

  try {
    return hub.rankResults(hub.mapShooterResults(JSON.parse(text), videoName), videoName).slice(0, 10);
  } catch (_) {
    return [];
  }
}

async function subhdRequest(url, method, referer, body) {
  const cookieJar = utils.resolvePath("@data/subhd-cookies.txt");
  const args = [
    "--http2",
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    "--connect-timeout", "10",
    "--max-time", "30",
    "-A", USER_AGENT,
    "-H", "Accept: application/json, text/javascript, */*; q=0.01",
    "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.6",
    "-b", cookieJar,
    "-c", cookieJar,
  ];
  if (referer) args.push("-e", referer);
  if (method === "POST") {
    args.push(
      "-X", "POST",
      "-H", "Content-Type: application/json; charset=UTF-8",
      "-H", "Origin: https://subhd.tv",
      "-H", "X-Requested-With: XMLHttpRequest",
      "--data-binary", body || "{}",
    );
  }
  args.push(url);
  return curlText(args, "SubHD 下载地址获取失败");
}

async function hydrateSubhd(result) {
  const preparedText = await subhdRequest(
    "https://subhd.tv/api/sub/prepare-download",
    "POST",
    result.detailUrl,
    JSON.stringify({ sid: result.id }),
  );
  const prepared = JSON.parse(preparedText);
  if (!prepared || prepared.success !== true || !/^\/down\//.test(prepared.url || "")) return null;

  const downPageUrl = `https://subhd.tv${prepared.url}`;
  await subhdRequest(downPageUrl, "GET", result.detailUrl);
  const downloadText = await subhdRequest(
    "https://subhd.tv/api/sub/down",
    "POST",
    downPageUrl,
    JSON.stringify({ sid: result.id }),
  );
  const download = JSON.parse(downloadText);
  if (!download || download.success !== true || download.pass !== true || !download.url) return null;

  const extensionMatch = String(download.url).match(/\.(srt|ass|ssa|sub|vtt|zip|rar|7z)(?:[?#]|$)/i);
  return Object.assign({}, result, {
    downloadUrl: download.url,
    downloadPageUrl: downPageUrl,
    fileName: `${result.title || result.id}.${extensionMatch ? extensionMatch[1].toLowerCase() : result.format}`,
    format: extensionMatch ? extensionMatch[1].toLowerCase() : result.format,
    needsDetail: false,
    score: (result.score || 0) + 15,
  });
}

function zimukuSearchUrl(videoName) {
  const query = hub.titleQuery(videoName) || hub.normalizeForSearch(videoName);
  return `https://zimuku.org/search?q=${encodeURIComponent(query)}`;
}

async function curlZimukuPage(url, cookieOverride) {
  const cookieJar = utils.resolvePath("@data/zimuku-cookies.txt");
  const outputPath = utils.resolvePath(`@tmp/zimuku-page-${Date.now()}-${Math.floor(Math.random() * 100000)}.html`);
  const curl = await utils.exec("/usr/bin/curl", [
    "--http1.1",
    "-L",
    "--compressed",
    "--connect-timeout", "10",
    "--max-time", "30",
    "-sS",
    "-A", USER_AGENT,
    "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.6",
    "-b", cookieOverride || cookieJar,
    "-c", cookieJar,
    "-o", outputPath,
    "-w", "%{http_code}",
    url,
  ]);

  const body = await utils.exec("/bin/cat", [outputPath]);
  await utils.exec("/bin/rm", ["-f", outputPath]);
  if (curl.status !== 0) throw new Error(curl.stderr || "字幕库连接失败");
  if (body.status !== 0) throw new Error(body.stderr || "无法读取字幕库页面");
  return {
    html: body.stdout || "",
    statusCode: parseInt((curl.stdout || "0").trim(), 10) || 0,
  };
}

async function verifyZimuku(url, challengeHtml) {
  console.log(`Zimuku verification skipped: ${url} (${String(challengeHtml || "").length} bytes)`);
  return null;
}

async function getZimukuPage(url) {
  try {
    let response = await curlZimukuPage(url);
    if (hub.isZimukuChallenge(response.html)) {
      zimukuProblem = "verification";
      response = await verifyZimuku(url, response.html);
      if (!response) throw new Error("Zimuku verification required");
    }
    if (response.statusCode >= 400) throw new Error(`Zimuku HTTP ${response.statusCode}`);
    return response.html;
  } catch (err) {
    if (/403|404|captcha|challenge|verification|security/i.test(String(err))) {
      zimukuProblem = "verification";
    } else if (!zimukuProblem) {
      zimukuProblem = "unavailable";
    }
    throw err;
  }
}

async function searchZimuku(videoName) {
  if (!boolPreference("zimuku_enabled", true)) return [];
  const html = await getZimukuPage(zimukuSearchUrl(videoName));
  return hub.sortResults(hub.parseZimukuSearch(html, videoName)).slice(0, 8);
}

async function hydrateResult(result, videoName) {
  if (!result.needsDetail) return result;

  if (result.source === "SubHD") {
    return hydrateSubhd(result);
  }

  if (result.source === "SubtitleCat") {
    const html = await getText(result.detailUrl);
    return hub.parseSubtitleCatDetail(html, result, getPreference("preferred_language", "zh-CN"));
  }

  if (result.source === "ASSRT") {
    const token = getPreference("assrt_token", "");
    const json = await getJson("https://api.assrt.net/v1/sub/detail", {
      token,
      id: String(result.id),
    });
    return hub.mapAssrtDetail(json, result, videoName, getPreference("preferred_language", "zh-CN"));
  }

  if (result.source === "Zimuku") {
    const detailHtml = await getZimukuPage(result.detailUrl);
    const withDownloadPage = hub.parseZimukuDetail(detailHtml, result);
    if (!withDownloadPage) return null;
    const downloadHtml = await getZimukuPage(withDownloadPage.downloadPageUrl);
    return hub.parseZimukuDownloadPage(downloadHtml, withDownloadPage);
  }

  return result;
}

async function searchAll() {
  const videoName = currentVideoName();
  const videoUrl = core.status.url;
  core.osd(`正在搜索中文字幕: ${hub.titleQuery(videoName) || videoName}`);

  const searches = [
    searchWithDeadline("SubHD", searchSubhd(videoName), 13000),
    searchWithDeadline("Xunlei", searchXunlei(videoName), 13000),
    searchWithDeadline("Shooter", searchShooter(videoName), 13000),
    searchWithDeadline("ASSRT", searchAssrt(videoName), 13000),
    searchWithDeadline("SubtitleCat", searchSubtitleCat(videoName), 13000),
  ];
  const settled = await Promise.all(searches);

  let results = [];
  settled.forEach((items) => {
    results = results.concat(items);
  });

  const seenResults = {};
  const uniqueResults = hub.rankResults(results, videoName).filter((item) => {
    const key = item.downloadUrl || item.detailUrl || `${item.source}:${item.id}:${item.title}:${item.language}`;
    if (seenResults[key]) return false;
    seenResults[key] = true;
    return true;
  });
  const limited = uniqueResults.slice(0, Number(getPreference("result_limit", 20)) || 20);
  if (!limited.length) {
    core.osd("没有找到片名和季集相符的字幕；可尝试翻译内置字幕");
  }
  return limited.map((item) => subtitle.item(Object.assign({}, item, { videoUrl })));
}

async function extractArchiveSubtitle(archivePath, result, videoName) {
  const listing = await utils.exec("/usr/bin/bsdtar", ["-tf", archivePath]);
  if (listing.status !== 0) {
    throw new Error(listing.stderr || "无法读取字幕压缩包");
  }

  const entry = hub.pickSubtitleFile(
    listing.stdout.split(/\r?\n/),
    videoName,
    getPreference("preferred_language", "zh-CN"),
    result.title,
  );
  if (!entry) throw new Error("压缩包内没有能确认属于当前集的字幕文件");

  const selected = Object.assign({}, result, { fileName: entry, downloadUrl: entry });
  const sameBasePath = boolPreference("save_next_to_video", true)
    ? hub.sameBaseSubtitlePath(core.status.url, selected)
    : "";
  const destination = sameBasePath || utils.resolvePath(`@tmp/${hub.makeDownloadName(selected, videoName)}`);
  const tempOutput = utils.resolvePath(`@tmp/cn-subtitle-hub-${Date.now()}-${hub.safeFileName(entry.split("/").pop())}`);
  const extracted = await utils.exec("/bin/sh", [
    "-c",
    "exec /usr/bin/bsdtar -xOf \"$1\" \"$2\" > \"$3\"",
    "extract-subtitle",
    archivePath,
    entry,
    tempOutput,
  ]);
  if (extracted.status !== 0) {
    await utils.exec("/bin/rm", ["-f", tempOutput]);
    throw new Error(extracted.stderr || "字幕解压失败");
  }

  const moved = await utils.exec("/bin/mv", ["-f", tempOutput, destination]);
  if (moved.status !== 0) throw new Error(moved.stderr || "字幕保存失败");
  await utils.exec("/bin/rm", ["-f", archivePath]);

  if (sameBasePath) core.osd(`字幕已保存: ${sameBasePath.split("/").pop()}`);
  return [destination];
}

async function downloadResult(item) {
  let result = item.data;
  if (result.videoUrl && result.videoUrl !== core.status.url) throw new Error("播放文件已切换，请重新搜索字幕");
  const videoUrl = core.status.url;
  const videoName = currentVideoName();
  if (result.needsDetail) {
    core.osd(`正在准备 ${result.source} 字幕…`);
    result = await hydrateResult(result, videoName);
    if (!result || !result.downloadUrl) {
      throw new Error(`${item.data.source} 字幕暂时无法下载`);
    }
  }
  if (core.status.url !== videoUrl) throw new Error("播放文件已切换，请重新搜索字幕");
  if (!hub.matchResult(result, videoName)) throw new Error("字幕的片名或季集不符，已停止下载");
  const fileIdentity = hub.mediaIdentity(result.fileName || "");
  if (hub.mediaIdentity(videoName).episode !== null && fileIdentity.episode !== null &&
      !hub.matchResult(Object.assign({}, result, { title: result.fileName, hashMatched: true }), videoName)) {
    throw new Error("下载文件的季集不符，已停止下载");
  }
  const sameBasePath = boolPreference("save_next_to_video", true)
    ? hub.sameBaseSubtitlePath(core.status.url, result)
    : "";
  const dest = sameBasePath || `@tmp/${hub.makeDownloadName(result, videoName)}`;
  const resolved = sameBasePath || utils.resolvePath(dest);

  if (result.source === "Zimuku") {
    const cookieJar = utils.resolvePath("@data/zimuku-cookies.txt");
    const downloaded = await utils.exec("/usr/bin/curl", [
      "--http1.1",
      "-L",
      "--fail",
      "--connect-timeout", "10",
      "--max-time", "60",
      "-sS",
      "-A", USER_AGENT,
      "-b", cookieJar,
      "-c", cookieJar,
      "-e", result.downloadPageUrl || result.detailUrl || result.downloadUrl,
      "-o", resolved,
      result.downloadUrl,
    ]);
    if (downloaded.status !== 0) throw new Error(downloaded.stderr || "字幕库下载失败");
  } else if (["SubHD", "迅雷字幕", "射手字幕"].indexOf(result.source) >= 0) {
    const downloaded = await utils.exec("/usr/bin/curl", [
      "-L",
      "--fail",
      "--silent",
      "--show-error",
      "--connect-timeout", "10",
      "--max-time", "60",
      "-A", USER_AGENT,
      "-e", result.downloadPageUrl || result.detailUrl || result.downloadUrl,
      "-o", resolved,
      result.downloadUrl,
    ]);
    if (downloaded.status !== 0) throw new Error(downloaded.stderr || `${result.source}下载失败`);
  } else {
    await http.download(result.downloadUrl, dest, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": result.detailUrl || result.downloadUrl,
      },
    });
  }

  if (hub.ARCHIVE_EXTENSIONS.test(resolved)) {
    try {
      return await extractArchiveSubtitle(resolved, result, videoName);
    } catch (err) {
      core.osd(`字幕解压失败: ${String(err).replace(/^Error:\s*/, "")}`);
      throw err;
    }
  } else if (sameBasePath) {
    core.osd(`字幕已保存: ${sameBasePath.split("/").pop()}`);
  }
  return [resolved];
}

subtitle.registerProvider(PROVIDER_ID, {
  search: searchAll,
  description: (item) => {
    const result = item.data;
    return {
      name: result.title || result.fileName || "Subtitle",
      left: `${result.source} · ${result.language || "unknown"} · ${result.format || "subtitle"}`,
      right: `${result.matchLabel || "待核对"} · 热度 ${result.downloads || 0}`,
    };
  },
  download: downloadResult,
});

event.on("iina.menu-update", () => {
  menu.removeAllItems();
  menu.addItem(menu.item("在 SubHD 搜索当前视频", () => {
    const query = hub.titleQuery(currentVideoName()) || hub.normalizeForSearch(currentVideoName());
    utils.exec("/usr/bin/open", [`https://subhd.tv/search/${encodeURIComponent(query)}`]);
    core.osd("已在浏览器打开 SubHD 搜索");
  }));

  menu.addItem(menu.item("设置 ASSRT Token", () => {
    const token = utils.prompt("粘贴 ASSRT API Token");
    if (!token) return;
    preferences.set("assrt_token", token.trim());
    preferences.sync();
    core.osd("ASSRT Token 已保存");
  }));

  menu.addItem(menu.item("清除 ASSRT Token", () => {
    preferences.set("assrt_token", "");
    preferences.sync();
    core.osd("ASSRT Token 已清除");
  }));
});

console.log("CN Subtitle Hub provider registered");
