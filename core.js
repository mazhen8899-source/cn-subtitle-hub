(function (root, factory) {
  root = root || (typeof globalThis !== "undefined" ? globalThis : this);
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CNSubtitleHubCore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof global !== "undefined" ? global : this), function () {
  const VIDEO_EXTENSIONS = /\.(mkv|mp4|avi|mov|wmv|m4v|webm|flv)$/i;
  const SUBTITLE_EXTENSIONS = /\.(srt|ass|ssa|sub|vtt)$/i;
  const ARCHIVE_EXTENSIONS = /\.(zip|rar|7z)$/i;
  const SUBHD_BASE_URL = "https://subhd.tv";
  const ZIMUKU_BASE_URL = "https://zimuku.org";

  function htmlDecode(value) {
    if (!value) return "";
    return String(value)
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#039;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ");
  }

  function stripTags(value) {
    return htmlDecode(String(value || "").replace(/<[^>]+>/g, " "));
  }

  function basename(path) {
    const raw = String(path || "").split(/[?#]/)[0];
    return decodeURIComponent(raw.substring(raw.lastIndexOf("/") + 1));
  }

  function decodeFileUrl(url) {
    const raw = String(url || "");
    if (!/^file:\/\//i.test(raw)) return "";
    const withoutScheme = raw.replace(/^file:\/\//i, "");
    const withoutHost = withoutScheme.replace(/^localhost/i, "");
    try {
      return decodeURIComponent(withoutHost);
    } catch (_) {
      return withoutHost;
    }
  }

  function dirname(path) {
    const normalized = String(path || "");
    const index = normalized.lastIndexOf("/");
    return index > 0 ? normalized.slice(0, index) : "";
  }

  function stripVideoExtension(name) {
    return String(name || "").replace(VIDEO_EXTENSIONS, "");
  }

  function normalizeForSearch(value) {
    return stripVideoExtension(basename(value))
      .replace(/\[[^\]]+\]|\([^\)]*\bYTS\b[^\)]*\)/gi, " ")
      .replace(/[._]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractYear(value) {
    const match = String(value || "").match(/\b(19\d{2}|20\d{2})\b/);
    return match ? match[1] : "";
  }

  function titleQuery(value) {
    return searchQueries(value)[0] || "";
  }

  function chineseNumber(value) {
    if (/^\d+$/.test(value)) return Number(value);
    const digits = "零一二三四五六七八九";
    const parts = value.replace(/两/g, "二").split("十");
    if (parts.length === 2) return (parts[0] ? digits.indexOf(parts[0]) : 1) * 10 + (parts[1] ? digits.indexOf(parts[1]) : 0);
    return digits.indexOf(value);
  }

  function mediaIdentity(value) {
    const text = htmlDecode(String(value || "")).replace(/[._]+/g, " ");
    const numbers = "[0-9零一二三四五六七八九十两]+";
    const seasonMatch = text.match(/\bS(?:eason)?\s*(\d{1,2})(?=\s|E|$|[^a-z0-9])/i) ||
      text.match(/\b(\d{1,2})x\d{1,3}\b/i) || text.match(new RegExp(`第(${numbers})季`));
    const episodeMatch = text.match(/S\d{1,2}\s*E(\d{1,3})(?!\d)/i) || text.match(/\bE(?:P(?:isode)?)?\s*(\d{1,3})(?!\d)/i) ||
      text.match(/\b\d{1,2}x(\d{1,3})\b/i) || text.match(new RegExp(`第?(${numbers})\\s*(?:[-~至到]\\s*第?${numbers}\\s*)?[集话話]`)) ||
      text.match(/S\d{1,2}\s*E(\d{1,3})(?!\d)/i);
    const season = seasonMatch ? chineseNumber(seasonMatch[1]) : null;
    const episode = episodeMatch ? chineseNumber(episodeMatch[1]) : null;
    let episodeEnd = episode;
    if (episodeMatch) {
      const tail = text.slice(episodeMatch.index + episodeMatch[0].length);
      const range = tail.match(/^\s*[-~至到]\s*(?:S\d{1,2}\s*)?(?:E(?:P(?:isode)?)?)?\s*(\d{1,3})(?!\d)/i) ||
        episodeMatch[0].match(new RegExp(`[-~至到]\\s*第?(${numbers})`));
      if (range) episodeEnd = chineseNumber(range[1]);
    }
    const extraEpisodes = [];
    const extraPattern = /E(\d{1,3})(?!\d)/gi;
    let extra;
    while ((extra = extraPattern.exec(text))) extraEpisodes.push(Number(extra[1]));
    const boundary = [seasonMatch, episodeMatch, text.match(/\b(?:19\d{2}|20\d{2}|2160p|1080p|720p|480p|BluRay|BDRip|WEB[- ]?DL|WEBRip|HDR10|AMZN|NF|HMAX)\b/i)]
      .filter(Boolean).reduce((index, match) => Math.min(index, match.index), text.length);
    const title = text.slice(0, boundary).replace(/\[[^\]]*(?:字幕|组|組)[^\]]*\]/g, " ")
      .replace(/[\[\](){}\/-]+/g, " ").replace(/\s+/g, " ").trim();
    return { title, year: extractYear(text), season, episode, episodeEnd, extraEpisodes };
  }

  function searchQueries(value) {
    const info = mediaIdentity(stripVideoExtension(basename(value)));
    const season = info.season === null ? "" : `S${String(info.season).padStart(2, "0")}`;
    const episode = info.episode === null ? "" : `E${String(info.episode).padStart(2, "0")}`;
    const primary = `${info.title} ${season}${episode || (!season ? info.year : "")}`.trim();
    const fallback = season && episode ? `${info.title} ${season}` : "";
    return [primary, fallback].filter((query, index, all) => query && all.indexOf(query) === index);
  }

  function episodeMatchInfo(candidate, video) {
    if (candidate.season !== null && video.season !== null && candidate.season !== video.season) return { reject: true };
    if (video.episode === null) return { tier: 1, label: "片名相符" };
    if (candidate.episode !== null) {
      const includes = candidate.episode === video.episode || candidate.extraEpisodes.indexOf(video.episode) >= 0 ||
        (candidate.episode <= video.episode && candidate.episodeEnd >= video.episode);
      if (!includes) return { reject: true };
      const multiple = candidate.episodeEnd !== candidate.episode || candidate.extraEpisodes.some((n) => n !== candidate.episode);
      return { tier: candidate.season === null ? 1 : multiple ? 2 : 3,
        label: candidate.season === null ? "集号相符·季待核对" : multiple ? "包含本集·合集" : "剧名和季集相符" };
    }
    return { tier: candidate.season === null ? 0 : 1,
      label: candidate.season === null ? "集号待核对" : "同季·集号待核对" };
  }

  function matchResult(result, videoName) {
    const video = mediaIdentity(videoName);
    const candidate = mediaIdentity(result.title || result.fileName);
    const match = episodeMatchInfo(candidate, video);
    if (match.reject) return null;
    const titleTokens = video.title.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
    const candidateText = candidate.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ");
    const titleMatches = titleTokens.length && new RegExp(`(?:^|[^a-z0-9])${titleTokens.map(escapeRegExp).join("\\s+")}(?:$|[^a-z0-9])`, "i").test(candidateText);
    if (!result.hashMatched && !titleMatches) return null;
    if (!result.hashMatched && video.episode === null && video.year && candidate.year && video.year !== candidate.year) return null;
    const releaseText = result.title || result.fileName || "";
    let releaseScore = 0;
    [/\bAMZN\b/i, /\bHMAX\b/i, /\bNF\b/i, /\bATVP\b/i].forEach((pattern) => {
      if (pattern.test(videoName) && pattern.test(releaseText)) releaseScore += 20;
    });
    [/web[-. ]?dl/i, /bluray/i, /webrip/i].forEach((pattern) => {
      if (pattern.test(videoName) && pattern.test(releaseText)) releaseScore += 10;
    });
    [/2160p/i, /1080p/i, /720p/i].forEach((pattern) => {
      if (pattern.test(videoName) && pattern.test(releaseText)) releaseScore += 4;
    });
    return Object.assign({}, result, { matchTier: result.hashMatched ? 4 : match.tier,
      matchLabel: result.hashMatched ? "文件指纹匹配" : match.label, releaseScore });
  }

  function rankResults(results, videoName) {
    return sortResults(results.map((result) => matchResult(result, videoName)).filter(Boolean));
  }

  function compact(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  }

  function isChineseLanguage(lang, title) {
    const combined = `${lang || ""} ${title || ""}`.toLowerCase();
    return /(?:^|[^a-z])(?:zh(?:[-_](?:cn|tw|hans|hant))?|chi|zho|chs|cht|cn|chinese)(?:$|[^a-z])/.test(combined) ||
      /中文|简体|繁体|繁體|双语|雙語|中英|简英|繁英/.test(combined);
  }

  function scoreTitle(candidate, videoName, sourceBoost) {
    const cleanVideo = compact(stripVideoExtension(videoName));
    const cleanCandidate = compact(stripVideoExtension(candidate));
    const query = compact(mediaIdentity(videoName).title);
    const year = extractYear(videoName);
    let score = sourceBoost || 0;

    if (cleanCandidate && cleanVideo && cleanCandidate === cleanVideo) score += 100;
    if (cleanCandidate && cleanVideo && cleanCandidate.indexOf(cleanVideo) >= 0) score += 60;
    if (query && cleanCandidate.indexOf(query) >= 0) score += 40;
    if (year && cleanCandidate.indexOf(year) >= 0) score += 10;
    if (/1080p/i.test(videoName) && /1080p/i.test(candidate)) score += 6;
    if (/720p/i.test(videoName) && /720p/i.test(candidate)) score += 4;
    if (/bluray/i.test(videoName) && /bluray/i.test(candidate)) score += 5;
    if (/web[-.]?dl|webrip/i.test(videoName) && /web[-.]?dl|webrip/i.test(candidate)) score += 5;
    if (/\bAMZN\b/i.test(videoName) && /\bAMZN\b/i.test(candidate)) score += 15;
    if (/2160p/i.test(videoName) && /2160p/i.test(candidate)) score += 6;
    if (/yts/i.test(videoName) && /yts/i.test(candidate)) score += 8;

    return score;
  }

  function safeFileName(value) {
    return String(value || "subtitle")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || "subtitle";
  }

  function extensionFromNameOrUrl(name, url) {
    const value = `${name || ""} ${url || ""}`;
    const match = value.match(/\.(srt|ass|ssa|sub|vtt|zip|rar|7z)(?:[?#\s]|$)/i);
    return match ? match[1].toLowerCase() : "srt";
  }

  function parseSubtitleCatSearch(html, videoName) {
    const results = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html))) {
      const row = rowMatch[1];
      const link = row.match(/<a\s+href="([^"]*subs\/\d+\/[^"]+\.html)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!link) continue;

      const title = stripTags(link[2]).trim();
      const translatedFrom = stripTags((row.match(/\(translated from ([^)]+)\)/i) || [])[1]).trim();
      const downloads = parseInt(((row.match(/<td>\s*(\d+)\s+downloads\s*<\/td>/i) || [])[1] || "0"), 10);
      const detailUrl = absolutizeSubtitleCatUrl(htmlDecode(link[1]));
      const languageHint = /chinese/i.test(translatedFrom) ? "zh-CN" : "";
      let score = scoreTitle(title, videoName, 20);
      if (languageHint) score += 20;
      score += Math.min(downloads, 50) / 10;

      results.push({
        source: "SubtitleCat",
        title,
        language: languageHint || "unknown",
        format: "html",
        downloads,
        translatedFrom,
        detailUrl,
        score,
        needsDetail: true,
      });
    }
    return dedupe(results, (item) => item.detailUrl);
  }

  function parseSubtitleCatDetail(html, baseResult, preferredLanguage) {
    const desired = preferredLanguage || "zh-CN";
    const exact = new RegExp(`<a[^>]+href="([^"]+)"[^>]*id="download_${escapeRegExp(desired)}"[^>]*>Download<\\/a>|<a[^>]+id="download_${escapeRegExp(desired)}"[^>]*href="([^"]+)"[^>]*>Download<\\/a>`, "i");
    const exactMatch = html.match(exact);
    const directHref = exactMatch && (exactMatch[1] || exactMatch[2]);

    let href = directHref;
    let lang = desired;
    if (!href) {
      const zhMatch = html.match(/<a[^>]+id="download_(zh-CN|zh-Hans|zh|zh-TW)"[^>]*href="([^"]+)"[^>]*>Download<\/a>/i);
      if (zhMatch) {
        lang = zhMatch[1];
        href = zhMatch[2];
      }
    }
    if (!href) return null;

    const url = absolutizeSubtitleCatUrl(htmlDecode(href));
    const fileName = basename(url);
    return Object.assign({}, baseResult, {
      language: lang,
      format: extensionFromNameOrUrl(fileName, url),
      fileName,
      downloadUrl: url,
      needsDetail: false,
      score: (baseResult.score || 0) + 35,
    });
  }

  function parseSubhdSearch(html, videoName) {
    const anchors = [];
    const resultRegex = /<div[^>]*class=["'][^"']*\bview-text\b[^"']*["'][^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = resultRegex.exec(String(html || "")))) {
      const href = attributeValue(match[1], "href");
      const idMatch = href.match(/\/a\/([A-Za-z0-9_-]+)/i);
      if (!idMatch) continue;
      anchors.push({
        id: idMatch[1],
        index: match.index,
        end: resultRegex.lastIndex,
        href,
        title: stripTags(match[2]).trim(),
      });
    }

    const results = anchors.map((anchor, index) => {
      const nextIndex = anchors[index + 1] ? anchors[index + 1].index : String(html || "").length;
      const chunk = String(html || "").slice(anchor.end, nextIndex);
      const tagBlock = (chunk.match(/<div[^>]*class=["'][^"']*\btext-truncate\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "";
      const tags = [];
      const tagRegex = /<span\b[^>]*>([\s\S]*?)<\/span>/gi;
      let tagMatch;
      while ((tagMatch = tagRegex.exec(tagBlock))) {
        const value = stripTags(tagMatch[1]).trim();
        if (value) tags.push(value);
      }

      const languages = tags.filter((value) => /简体|繁体|繁體|双语|雙語|中文|英语|英語/i.test(value));
      const language = languages.join("/") || "中文";
      const format = (tags.find((value) => /^(srt|ass|ssa|sub|vtt|zip|rar|7z)$/i.test(value)) || "subtitle").toLowerCase();
      const downloadMatch = chunk.match(/class=["'][^"']*\bbi-download\b[^"']*["'][\s\S]*?<\/svg>\s*<span[^>]*>([\d,]+)/i);
      const downloads = parseInt((downloadMatch ? downloadMatch[1] : "0").replace(/,/g, ""), 10) || 0;
      let score = scoreTitle(anchor.title, videoName, 70);
      if (isChineseLanguage(language, anchor.title)) score += 35;
      score += Math.min(downloads, 5000) / 500;

      return {
        source: "SubHD",
        id: anchor.id,
        title: anchor.title,
        language,
        format,
        downloads,
        detailUrl: absolutizeSubhdUrl(anchor.href),
        score,
        needsDetail: true,
      };
    });

    return dedupe(results, (item) => item.detailUrl);
  }

  function mapXunleiResults(payload, videoName) {
    const list = payload && Array.isArray(payload.sublist) ? payload.sublist : [];
    const results = list.map((item) => {
      if (!item || !item.surl || !item.sname) return null;
      const format = extensionFromNameOrUrl(item.sname, item.surl);
      if (!SUBTITLE_EXTENSIONS.test(`.${format}`)) return null;

      const language = item.language || "unknown";
      if (!isChineseLanguage(language, item.sname) && !/未知|unknown/i.test(language)) return null;
      let score = scoreTitle(item.sname, videoName, 95);
      if (isChineseLanguage(language, item.sname)) score += 35;
      score += Math.min(Number(item.svote || 0), 10000) / 1000;

      return {
        source: "迅雷字幕",
        hashMatched: true,
        id: item.scid || item.surl,
        title: item.sname,
        language,
        format,
        downloads: Number(item.svote || 0),
        fileName: item.sname,
        downloadUrl: item.surl,
        score,
        needsDetail: false,
      };
    }).filter(Boolean);

    return dedupe(sortResults(results), (item) => item.downloadUrl);
  }

  function mapShooterResults(payload, videoName) {
    if (!Array.isArray(payload)) return [];
    const results = [];

    payload.forEach((item, groupIndex) => {
      const files = item && Array.isArray(item.Files || item.files) ? (item.Files || item.files) : [];
      files.forEach((file, fileIndex) => {
        const link = file.Link || file.link;
        const format = String(file.Ext || file.ext || extensionFromNameOrUrl("", link)).toLowerCase();
        if (!link || !SUBTITLE_EXTENSIONS.test(`.${format}`)) return;
        const number = results.length + 1;
        const title = item.Desc || item.desc || `射手中文字幕 ${number}`;
        results.push({
          source: "射手字幕",
          hashMatched: true,
          id: `${groupIndex}-${fileIndex}`,
          title,
          language: "中文",
          format,
          downloads: 0,
          fileName: `${safeFileName(videoName)}.shooter-${number}.${format}`,
          downloadUrl: link,
          delay: Number(item.Delay || item.delay || 0),
          score: 125 - number,
          needsDetail: false,
        });
      });
    });

    return dedupe(results, (item) => item.downloadUrl);
  }

  function parseZimukuSearch(html, videoName) {
    const results = [];
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html))) {
      const row = rowMatch[1];
      const anchor = findAnchor(row, (href) => /\/detail\/\d+\.html(?:[?#]|$)/i.test(href));
      if (!anchor) continue;

      const title = htmlDecode(anchor.title || stripTags(anchor.body)).trim();
      const language = zimukuLanguageFromRow(row);
      if (!isChineseLanguage(language, title)) continue;

      const formatMatch = row.match(/<span[^>]*class=["'][^"']*label-info[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
      const lastCell = row.match(/<td[^>]*class=["'][^"']*\blast\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
      const downloadText = stripTags(lastCell ? lastCell[1] : "");
      const downloads = parseInt((downloadText.match(/[\d,]+/) || ["0"])[0].replace(/,/g, ""), 10) || 0;
      let score = scoreTitle(title, videoName, 55) + 35;
      score += Math.min(downloads, 5000) / 500;

      results.push({
        source: "Zimuku",
        title,
        language,
        format: formatMatch ? stripTags(formatMatch[1]).trim().toLowerCase() : "subtitle",
        downloads,
        detailUrl: absolutizeZimukuUrl(anchor.href),
        score,
        needsDetail: true,
      });
    }

    return dedupe(results, (item) => item.detailUrl);
  }

  function parseZimukuDetail(html, baseResult) {
    const anchor = findAnchor(html, (href, attrs) => {
      return /\/dld\/\d+\.html(?:[?#]|$)/i.test(href) || /\bid\s*=\s*["']down1["']/i.test(attrs);
    });
    if (!anchor) return null;

    return Object.assign({}, baseResult, {
      downloadPageUrl: absolutizeZimukuUrl(anchor.href),
    });
  }

  function parseZimukuDownloadPage(html, baseResult) {
    const anchor = findAnchor(html, (href, attrs) => {
      return /\/download\//i.test(href) && /\brel\s*=\s*["'][^"']*nofollow/i.test(attrs);
    });
    if (!anchor) return null;

    const fileName = basename(baseResult.title) || `zimuku-${Date.now()}.zip`;
    const downloadUrl = absolutizeZimukuUrl(anchor.href);
    return Object.assign({}, baseResult, {
      fileName,
      format: extensionFromNameOrUrl(fileName, downloadUrl),
      downloadUrl,
      needsDetail: false,
      score: (baseResult.score || 0) + 15,
    });
  }

  function isZimukuChallenge(html) {
    return /security_session_verify|data:image\/bmp;base64|self\.location\s*=|stringToHex\s*\(/i.test(String(html || ""));
  }

  function extractZimukuChallengeImage(html) {
    const match = String(html || "").match(/data:image\/bmp;base64,([^"']+)/i);
    return match ? match[1].replace(/\s+/g, "") : "";
  }

  function stringToHex(value) {
    let output = "";
    const input = String(value || "");
    for (let index = 0; index < input.length; index += 1) {
      output += input.charCodeAt(index).toString(16);
    }
    return output;
  }

  function pickSubtitleFile(entries, videoName, preferredLanguage, containerTitle) {
    const preferTraditional = /^zh-(?:tw|hant)/i.test(preferredLanguage || "");
    const video = mediaIdentity(videoName);
    const container = mediaIdentity(containerTitle || "");
    let best = null;

    (entries || []).forEach((entry) => {
      const normalized = String(entry || "").trim().replace(/\\/g, "/");
      const parts = normalized.split("/");
      const fileName = parts[parts.length - 1] || "";
      if (!normalized || normalized.charAt(0) === "/" || parts.indexOf("..") >= 0) return;
      if (parts.some((part) => part === "__MACOSX" || part.charAt(0) === ".")) return;
      if (!SUBTITLE_EXTENSIONS.test(fileName)) return;
      if (video.episode !== null) {
        const identity = mediaIdentity(normalized);
        const matched = episodeMatchInfo(identity, video);
        if (matched.reject) return;
        // A season pack must identify the selected episode in its member path.
        if (identity.episode === null && !(container.episode === video.episode &&
            container.episodeEnd === video.episode && container.extraEpisodes.every((n) => n === video.episode) &&
            !episodeMatchInfo(container, video).reject)) return;
        if (identity.episode !== null && (identity.episodeEnd !== identity.episode || identity.extraEpisodes.some((n) => n !== video.episode))) return;
      }

      const lower = fileName.toLowerCase();
      const simplified = /简体|简中|(?:^|[._ -])chs(?:[._ -]|$)|zh[-_.]?cn|(?:^|[._ -])gb(?:[._ -]|$)/i.test(fileName);
      const traditional = /繁体|繁體|繁中|(?:^|[._ -])cht(?:[._ -]|$)|zh[-_.]?tw|big5/i.test(fileName);
      const bilingual = /中英|简英|簡英|繁英|双语|雙語|chs[.&_-]*eng|cht[.&_-]*eng|eng[.&_-]*ch[st]/i.test(fileName);
      const english = /(?:^|[._ -])eng(?:lish)?(?:[._ -]|$)/i.test(fileName);
      let score = scoreTitle(fileName, videoName, 0);

      if (simplified) score += preferTraditional ? 25 : 55;
      if (traditional) score += preferTraditional ? 55 : 25;
      if (bilingual) score += 35;
      if (!simplified && !traditional && /中文|中字|chinese/i.test(fileName)) score += 30;
      if (english && !simplified && !traditional && !bilingual) score -= 25;
      if (/\.ass$/i.test(lower)) score += 8;
      else if (/\.srt$/i.test(lower)) score += 7;
      else if (/\.ssa$/i.test(lower)) score += 6;
      else if (/\.vtt$/i.test(lower)) score += 4;
      else score += 2;

      if (!best || score > best.score || (score === best.score && normalized < best.name)) {
        best = { name: normalized, score };
      }
    });

    return best ? best.name : "";
  }

  function mapAssrtSearchItem(item, videoName) {
    const title = item.videoname || item.native_name || item.title || `ASSRT ${item.id}`;
    const langDesc = (item.lang && item.lang.desc) || "";
    let score = scoreTitle(title, videoName, 45);
    if (isChineseLanguage(langDesc, title)) score += 40;
    score += Number(item.vote_score || 0) * 2;

    return {
      source: "ASSRT",
      id: item.id,
      title,
      language: langDesc || "unknown",
      format: item.subtype || "subtitle",
      downloads: item.down_count || 0,
      detailUrl: `https://api.assrt.net/v1/sub/detail?id=${item.id}`,
      score,
      needsDetail: true,
      raw: item,
    };
  }

  function mapAssrtDetail(detail, baseResult, videoName, preferredLanguage) {
    const subs = detail && detail.sub && detail.sub.subs;
    const first = Array.isArray(subs) && subs.length ? subs[0] : null;
    if (!first) return null;

    const files = Array.isArray(first.filelist) ? first.filelist : [];
    const chosen = pickSubtitleFile(files.map((file) => file.f || basename(file.url)), videoName, preferredLanguage, baseResult.title);
    const directFile = files.find((file) => (file.f || basename(file.url)) === chosen) ||
      files.find((file) => ARCHIVE_EXTENSIONS.test(file.f || file.url || ""));
    if (files.length && !directFile) return null;
    const downloadUrl = directFile ? directFile.url : first.url;
    const fileName = directFile ? directFile.f : first.filename;
    if (!downloadUrl) return null;

    const title = first.videoname || first.title || first.native_name || baseResult.title;
    const lang = (first.lang && first.lang.desc) || baseResult.language || "";
    let score = (baseResult.score || 0) + scoreTitle(title, videoName, 10);
    if (isChineseLanguage(lang, title)) score += 20;

    return Object.assign({}, baseResult, {
      title,
      language: lang || "unknown",
      format: extensionFromNameOrUrl(fileName, downloadUrl),
      downloads: first.down_count || baseResult.downloads || 0,
      fileName: fileName || basename(downloadUrl),
      downloadUrl,
      score,
      needsDetail: false,
      raw: first,
    });
  }

  function absolutizeSubtitleCatUrl(href) {
    if (/^https?:\/\//i.test(href)) return href;
    if (href.charAt(0) === "/") return `https://www.subtitlecat.com${href}`;
    return `https://www.subtitlecat.com/${href.replace(/^\.?\//, "")}`;
  }

  function absolutizeSubhdUrl(href) {
    const value = htmlDecode(href || "").trim();
    if (/^https?:\/\//i.test(value)) return value;
    if (/^\/\//.test(value)) return `https:${value}`;
    if (value.charAt(0) === "/") return `${SUBHD_BASE_URL}${value}`;
    return `${SUBHD_BASE_URL}/${value.replace(/^\.?\//, "")}`;
  }

  function absolutizeZimukuUrl(href) {
    const value = htmlDecode(href || "").trim();
    if (/^https?:\/\//i.test(value)) return value;
    if (/^\/\//.test(value)) return `https:${value}`;
    if (value.charAt(0) === "/") return `${ZIMUKU_BASE_URL}${value}`;
    return `${ZIMUKU_BASE_URL}/${value.replace(/^\.?\//, "")}`;
  }

  function findAnchor(html, predicate) {
    const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorRegex.exec(html))) {
      const attrs = match[1];
      const href = attributeValue(attrs, "href");
      if (!href || !predicate(href, attrs)) continue;
      return {
        attrs,
        body: match[2],
        href,
        title: attributeValue(attrs, "title"),
      };
    }
    return null;
  }

  function attributeValue(attrs, name) {
    const match = String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
    return match ? htmlDecode(match[1] || match[2] || "") : "";
  }

  function zimukuLanguageFromRow(row) {
    const hints = [];
    const imageRegex = /<img\b([^>]*)>/gi;
    let match;
    while ((match = imageRegex.exec(row))) {
      ["alt", "title", "data-original-title", "src"].forEach((name) => {
        const value = attributeValue(match[1], name);
        if (value) hints.push(value);
      });
    }

    const combined = hints.join(" ");
    const languages = [];
    if (/简体|简中|china|jollyroger|chs|zh[-_]?cn/i.test(combined)) languages.push("简体中文");
    if (/繁体|繁體|繁中|hongkong|cht|zh[-_]?tw/i.test(combined)) languages.push("繁体中文");
    if (/english|英文/i.test(combined)) languages.push("English");
    return languages.join("/") || "unknown";
  }

  function dedupe(items, keyFn) {
    const seen = {};
    const out = [];
    items.forEach((item) => {
      const key = keyFn(item);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(item);
    });
    return out;
  }

  function sortResults(results) {
    return results.slice().sort((a, b) => {
      if ((a.matchTier || 0) !== (b.matchTier || 0)) return (b.matchTier || 0) - (a.matchTier || 0);
      const aZh = isChineseLanguage(a.language, a.title) ? 1 : 0;
      const bZh = isChineseLanguage(b.language, b.title) ? 1 : 0;
      if (aZh !== bZh) return bZh - aZh;
      if ((a.releaseScore || 0) !== (b.releaseScore || 0)) return (b.releaseScore || 0) - (a.releaseScore || 0);
      return (b.score || 0) - (a.score || 0);
    });
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function makeDownloadName(result, videoName) {
    const ext = extensionFromNameOrUrl(result.fileName, result.downloadUrl);
    const stem = safeFileName(stripVideoExtension(basename(videoName)) || stripVideoExtension(result.title));
    const source = safeFileName(result.source || "sub");
    const lang = safeFileName(result.language || "unknown").replace(/\s+/g, "-");
    return `${stem}.${source}.${lang}.${ext}`;
  }

  function sameBaseSubtitlePath(videoUrl, result) {
    const videoPath = decodeFileUrl(videoUrl);
    const dir = dirname(videoPath);
    const videoBase = stripVideoExtension(basename(videoPath));
    if (!dir || !videoBase) return "";
    const ext = extensionFromNameOrUrl(result && result.fileName, result && result.downloadUrl);
    if (ARCHIVE_EXTENSIONS.test(`.${ext}`)) return "";
    return `${dir}/${safeFileName(videoBase)}.${ext}`;
  }

  return {
    ARCHIVE_EXTENSIONS,
    SUBTITLE_EXTENSIONS,
    decodeFileUrl,
    dirname,
    extractZimukuChallengeImage,
    extractYear,
    htmlDecode,
    isChineseLanguage,
    mediaIdentity,
    matchResult,
    rankResults,
    searchQueries,
    makeDownloadName,
    mapAssrtDetail,
    mapAssrtSearchItem,
    mapShooterResults,
    mapXunleiResults,
    normalizeForSearch,
    parseSubhdSearch,
    parseZimukuDetail,
    parseZimukuDownloadPage,
    parseZimukuSearch,
    parseSubtitleCatDetail,
    parseSubtitleCatSearch,
    pickSubtitleFile,
    safeFileName,
    sortResults,
    sameBaseSubtitlePath,
    stringToHex,
    stripVideoExtension,
    titleQuery,
    isZimukuChallenge,
  };
});
