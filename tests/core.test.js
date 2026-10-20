const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const hub = require("../core.js");

const fixtureDir = path.join(__dirname, "fixtures");
const searchHtml = fs.readFileSync(path.join(fixtureDir, "subtitlecat-search.html"), "utf8");
const detailHtml = fs.readFileSync(path.join(fixtureDir, "subtitlecat-detail.html"), "utf8");
const subhdSearchHtml = fs.readFileSync(path.join(fixtureDir, "subhd-search.html"), "utf8");
const zimukuSearchHtml = fs.readFileSync(path.join(fixtureDir, "zimuku-search.html"), "utf8");
const zimukuDetailHtml = fs.readFileSync(path.join(fixtureDir, "zimuku-detail.html"), "utf8");
const zimukuDownloadHtml = fs.readFileSync(path.join(fixtureDir, "zimuku-download.html"), "utf8");
const video = "Gerda.2021.1080p.BluRay.x264.AAC5.1-[YTS.MX]";
const videoUrl = "file:///Users/example/Desktop/%E7%94%B5%E5%BD%B1/Gerda.2021.1080p.BluRay.x264.AAC5.1-%5BYTS.MX%5D/Gerda.2021.1080p.BluRay.x264.AAC5.1-%5BYTS.MX%5D.mp4";

assert.equal(hub.titleQuery(video), "Gerda 2021");
assert.equal(
  hub.sameBaseSubtitlePath(videoUrl, { fileName: "Gerda.zh-CN.srt" }),
  "/Users/example/Desktop/电影/Gerda.2021.1080p.BluRay.x264.AAC5.1-[YTS.MX]/Gerda.2021.1080p.BluRay.x264.AAC5.1-[YTS.MX].srt",
);

const searchResults = hub.parseSubtitleCatSearch(searchHtml, video);
assert.equal(searchResults.length, 2);
assert.equal(searchResults[0].source, "SubtitleCat");
assert.ok(searchResults[0].detailUrl.includes("subtitlecat.com/subs/1019/"));

const detailed = hub.parseSubtitleCatDetail(detailHtml, searchResults[0], "zh-CN");
assert.ok(detailed.downloadUrl.endsWith("-zh-CN.srt"));
assert.equal(detailed.language, "zh-CN");
assert.equal(detailed.format, "srt");

const subhdResults = hub.parseSubhdSearch(subhdSearchHtml, video);
assert.equal(subhdResults.length, 2);
assert.equal(subhdResults[0].source, "SubHD");
assert.equal(subhdResults[0].language, "简体");
assert.equal(subhdResults[0].format, "ass");
assert.equal(subhdResults[0].downloads, 6);
assert.equal(subhdResults[0].detailUrl, "https://subhd.tv/a/tSOoOy");

const xunlei = hub.mapXunleiResults({
  sublist: [{
    scid: "abc",
    sname: "Gerda.2021.chs.ass",
    language: "简体",
    surl: "http://subtitle.test/Gerda.ass",
    svote: 42,
  }, {}],
}, video);
assert.equal(xunlei.length, 1);
assert.equal(xunlei[0].source, "迅雷字幕");
assert.equal(xunlei[0].format, "ass");

const shooter = hub.mapShooterResults([{
  Desc: "",
  Delay: 0,
  Files: [{ Ext: "srt", Link: "https://shooter.test/fetch?id=1" }],
}], video);
assert.equal(shooter.length, 1);
assert.equal(shooter[0].source, "射手字幕");
assert.equal(shooter[0].language, "中文");

const zimukuResults = hub.parseZimukuSearch(zimukuSearchHtml, video);
assert.equal(zimukuResults.length, 1);
assert.equal(zimukuResults[0].source, "Zimuku");
assert.equal(zimukuResults[0].language, "简体中文/繁体中文/English");
assert.equal(zimukuResults[0].downloads, 2597);
assert.equal(zimukuResults[0].detailUrl, "https://zimuku.org/detail/177622.html");

const zimukuDetailed = hub.parseZimukuDetail(zimukuDetailHtml, zimukuResults[0]);
assert.equal(zimukuDetailed.downloadPageUrl, "https://zimuku.org/dld/177622.html");
const zimukuDownload = hub.parseZimukuDownloadPage(zimukuDownloadHtml, zimukuDetailed);
assert.equal(zimukuDownload.downloadUrl, "https://zimuku.org/download/example-token/svr/d0");
assert.equal(zimukuDownload.format, "zip");

assert.equal(hub.pickSubtitleFile([
  "Gerda/Gerda.eng.srt",
  "Gerda/Gerda.cht.srt",
  "Gerda/Gerda.chs.srt",
], video, "zh-CN"), "Gerda/Gerda.chs.srt");
assert.equal(hub.pickSubtitleFile([
  "Movie/Movie.chs.srt",
  "Movie/Movie.chs.eng.ass",
], video, "zh-CN"), "Movie/Movie.chs.eng.ass");
assert.equal(hub.pickSubtitleFile([
  "Movie/Movie.chs.srt",
  "Movie/Movie.cht.srt",
], video, "zh-TW"), "Movie/Movie.cht.srt");
assert.ok(hub.isZimukuChallenge('<img src="data:image/bmp;base64,AAAA">'));
assert.equal(hub.extractZimukuChallengeImage('<img src="data:image/bmp;base64,QUJDRA==">'), "QUJDRA==");
assert.equal(hub.stringToHex("A1"), "4131");

const assrt = hub.mapAssrtDetail({
  status: 0,
  sub: {
    subs: [{
      id: 123456,
      videoname: video,
      down_count: 12,
      lang: { desc: "简体 双语" },
      filelist: [{
        f: `${video}.srt`,
        url: "https://example.test/sub.srt",
      }],
    }],
  },
}, { source: "ASSRT", title: video, score: 20 }, video);
assert.equal(assrt.language, "简体 双语");
assert.equal(assrt.downloadUrl, "https://example.test/sub.srt");

const sorted = hub.sortResults([
  { title: "English", language: "en", score: 100 },
  { title: "Chinese", language: "zh-CN", score: 10 },
]);
assert.equal(sorted[0].language, "zh-CN");

console.log("core tests passed");

const episodeVideo = "Lanterns.S01E03.2160p.AMZN.WEB-DL.DV.HDR10+[Ben The Men]";
assert.deepEqual(hub.searchQueries(episodeVideo), ["Lanterns S01E03", "Lanterns S01"]);
for (const title of ["Lanterns S01E01", "Lanterns S01E30", "Lanterns S02E03", "Other S01E03", "GreenLanterns S01E03", "Lanterns S01E04-E08"]) {
  assert.equal(hub.matchResult({ title, score: 9999, language: "中文" }, episodeVideo), null, title);
}
for (const title of ["Lanterns S01E03", "Lanterns 1x03", "Lanterns Season 1 Episode 3", "灯笼 Lanterns 第一季 第三集"]) {
  assert.equal(hub.matchResult({ title }, episodeVideo).matchTier, 3, title);
}
for (const title of ["Lanterns S01E01-E08", "Lanterns S01E01-08", "Lanterns S01E02E03", "Lanterns 第一季 第1-8集"]) {
  assert.equal(hub.matchResult({ title }, episodeVideo).matchTier, 2, title);
}
assert.equal(hub.matchResult({ title: "Lanterns S01E02E04" }, episodeVideo), null);
assert.equal(hub.matchResult({ title: "Lanterns S01" }, episodeVideo).matchTier, 1);
assert.equal(hub.isChineseLanguage("", "Chicago.2026.srt"), false);
assert.equal(hub.isChineseLanguage("", "Lanterns.chs.eng.ass"), true);
const episodeRanked = hub.rankResults([
  { title: "Lanterns S01", score: 999, language: "中文" },
  { title: "Lanterns S01E02", score: 9999, language: "中文" },
  { title: "Lanterns S01E03 1080p", score: 1, language: "en" },
], episodeVideo);
assert.equal(episodeRanked.length, 2);
assert.equal(episodeRanked[0].matchTier, 3);
assert.equal(hub.rankResults([
  { title: "Lanterns S01E03 1080p AMZN WEB-DL", language: "中文", score: 9999 },
  { title: "Lanterns S01E03 2160p HMAX WEB-DL", language: "中文", score: 9999 },
  { title: "Lanterns S01E03 2160p AMZN WEB-DL", language: "中文", score: 1 },
], episodeVideo)[0].title, "Lanterns S01E03 2160p AMZN WEB-DL");
assert.equal(hub.pickSubtitleFile(["Lanterns.S01E01.chs.ass", "Lanterns.S01E03.chs.srt", "Lanterns.S02E03.chs.ass"], episodeVideo), "Lanterns.S01E03.chs.srt");
assert.equal(hub.pickSubtitleFile(["Season 1/Episode 3.chs.srt", "Season 2/Episode 3.chs.ass"], episodeVideo), "Season 1/Episode 3.chs.srt");
assert.equal(hub.pickSubtitleFile(["Lanterns.S01E01.chs.ass", "chs.srt"], episodeVideo, "zh-CN", "Lanterns S01"), "");
assert.equal(hub.pickSubtitleFile(["chs.srt"], episodeVideo, "zh-CN", "Lanterns S01E03"), "chs.srt");
assert.equal(hub.pickSubtitleFile(["chs.srt"], episodeVideo, "zh-CN", "Lanterns S01E03-E05"), "");
const seasonDetail = { sub: { subs: [{ filelist: [
  { f: "Lanterns.S01E01.chs.srt", url: "https://example.test/e1.srt" },
  { f: "Lanterns.S01E03.chs.srt", url: "https://example.test/e3.srt" },
] }] } };
assert.equal(hub.mapAssrtDetail(seasonDetail, { title: "Lanterns S01" }, episodeVideo).downloadUrl, "https://example.test/e3.srt");
seasonDetail.sub.subs[0].filelist.pop();
assert.equal(hub.mapAssrtDetail(seasonDetail, { title: "Lanterns S01" }, episodeVideo), null);
console.log("episode matching tests passed");
