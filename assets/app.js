const API = "https://graphql.anilist.co";
const BLOCKED_TAGS = ["Loli", "Shota"];
const BLOCKED_RE = /\b(loli|shota|lolicon|shotacon|toddlercon)\b/i;
const STORE = {
  list: "blaze.list",
  age: "blaze.age18",
  continue: "blaze.continue",
};

const CARD_FIELDS = `
  id
  title { romaji english native }
  coverImage { extraLarge large color }
  bannerImage
  averageScore
  episodes
  format
  status
  season
  seasonYear
  genres
  isAdult
  description(asHtml: false)
  trailer { id site }
  nextAiringEpisode { episode airingAt }
  tags { name isMediaSpoiler }
`;

const cache = new Map();

function seasonNow() {
  const m = new Date().getMonth() + 1;
  const y = new Date().getFullYear();
  const season = m <= 3 ? "WINTER" : m <= 6 ? "SPRING" : m <= 9 ? "SUMMER" : "FALL";
  return { season, year: y };
}

function titleOf(m) {
  return m.title?.english || m.title?.romaji || m.title?.native || "Untitled";
}

function safe(media) {
  if (!media) return false;
  const names = (media.tags || []).map((t) => t.name);
  if (names.some((n) => BLOCKED_TAGS.includes(n) || BLOCKED_RE.test(n))) return false;
  const blob = [titleOf(media), media.title?.native, ...(media.genres || []), ...(media.synonyms || [])].join(" ");
  return !BLOCKED_RE.test(blob);
}

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function ageOk() {
  return load(STORE.age, false) === true;
}

async function gql(query, variables = {}) {
  const key = JSON.stringify({ query, variables });
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error("AniList request failed");
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || "GraphQL error");
  cache.set(key, json.data);
  return json.data;
}

async function pageMedia(vars) {
  const data = await gql(
    `query (
      $page: Int = 1,
      $perPage: Int = 24,
      $sort: [MediaSort],
      $search: String,
      $genre: String,
      $season: MediaSeason,
      $seasonYear: Int,
      $status: MediaStatus,
      $format: MediaFormat,
      $isAdult: Boolean
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage currentPage lastPage }
        media(
          type: ANIME
          sort: $sort
          search: $search
          genre: $genre
          season: $season
          seasonYear: $seasonYear
          status: $status
          format: $format
          isAdult: $isAdult
          tag_not_in: ["Loli", "Shota"]
        ) { ${CARD_FIELDS} }
      }
    }`,
    vars
  );
  data.Page.media = data.Page.media.filter(safe);
  if (!ageOk()) data.Page.media = data.Page.media.filter((m) => !m.isAdult);
  return data.Page;
}

async function getAnime(id) {
  const data = await gql(
    `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${CARD_FIELDS}
        synonyms
        duration
        source
        popularity
        siteUrl
        studios { nodes { name } }
        externalLinks { url site type }
        streamingEpisodes { title thumbnail url site }
        relations {
          edges {
            relationType
            node { id type title { romaji english } coverImage { large } isAdult }
          }
        }
        recommendations(sort: RATING_DESC, perPage: 12) {
          nodes {
            mediaRecommendation { id title { romaji english } coverImage { large } isAdult }
          }
        }
      }
    }`,
    { id: Number(id) }
  );
  return data.Media;
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function posterUrl(m) {
  return m.coverImage?.extraLarge || m.coverImage?.large || "";
}

function card(m) {
  const live = m.status === "RELEASING";
  return `
    <a class="card" href="#/anime/${m.id}" title="${escapeHtml(titleOf(m))}">
      <div class="poster" style="background-image:url('${posterUrl(m)}')">
        ${live ? `<span class="badge">LIVE</span>` : m.averageScore ? `<span class="badge">${m.averageScore}</span>` : ""}
      </div>
      <div class="card-body">
        <h3>${escapeHtml(titleOf(m))}</h3>
        <div class="sub">${[m.format, m.seasonYear || "", m.isAdult ? "18+" : ""].filter(Boolean).join(" · ")}</div>
      </div>
    </a>`;
}

function rail(title, items, moreHref) {
  if (!items?.length) return "";
  return `
    <section class="rail">
      <div class="rail-head">
        <h2>${title}</h2>
        ${moreHref ? `<a href="${moreHref}">See all</a>` : ""}
      </div>
      <div class="scroller">${items.map(card).join("")}</div>
    </section>`;
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripHtml(s = "") {
  return escapeHtml(String(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function inList(id) {
  return load(STORE.list, []).includes(Number(id));
}
function toggleList(id) {
  const list = load(STORE.list, []);
  const n = Number(id);
  const next = list.includes(n) ? list.filter((x) => x !== n) : [n, ...list];
  save(STORE.list, next);
}

function trailerSrc(trailer) {
  if (!trailer?.id) return "";
  if (trailer.site === "youtube") return `https://www.youtube.com/embed/${encodeURIComponent(trailer.id)}?autoplay=1&rel=0`;
  if (trailer.site === "dailymotion") return `https://www.dailymotion.com/embed/video/${encodeURIComponent(trailer.id)}`;
  return "";
}

function streamingLinks(media) {
  return (media.externalLinks || []).filter((l) => l.type === "STREAMING");
}

const app = document.getElementById("app");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const ageGate = document.getElementById("age-gate");

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
});

document.getElementById("age-yes").onclick = () => {
  save(STORE.age, true);
  ageGate.classList.add("hidden");
  route();
};
document.getElementById("age-no").onclick = () => {
  ageGate.classList.add("hidden");
  location.hash = "#/";
};

function setNav(name) {
  document.querySelectorAll(".nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === name);
  });
}

function skeletons(n = 8) {
  return `<div class="grid">${Array.from({ length: n }, () => `<div class="skeleton" style="height:280px"></div>`).join("")}</div>`;
}

async function renderHome() {
  setNav("home");
  const { season, year } = seasonNow();
  app.innerHTML = `<div class="hero"><div class="hero-copy"><div class="kicker">Loading catalog</div><h1>Finding what's on fire.</h1></div></div>${skeletons()}`;
  const [trending, popular, seasonal, movies, airing] = await Promise.all([
    pageMedia({ sort: ["TRENDING_DESC"], perPage: 18, isAdult: false }),
    pageMedia({ sort: ["POPULARITY_DESC"], perPage: 18, isAdult: false }),
    pageMedia({ sort: ["POPULARITY_DESC"], season, seasonYear: year, perPage: 18, isAdult: false }),
    pageMedia({ sort: ["POPULARITY_DESC"], format: "MOVIE", perPage: 18, isAdult: false }),
    pageMedia({ sort: ["TRENDING_DESC"], status: "RELEASING", perPage: 18, isAdult: false }),
  ]);
  const hero = trending.media[0] || popular.media[0];
  const cont = load(STORE.continue, []).slice(0, 12);
  const contCards = cont.length
    ? `<section class="rail"><div class="rail-head"><h2>Continue watching</h2></div><div class="scroller">${cont
        .map(
          (c) => `
      <a class="card" href="#/watch/${c.id}">
        <div class="poster" style="background-image:url('${c.cover}')"></div>
        <div class="card-body"><h3>${escapeHtml(c.title)}</h3><div class="sub">Trailer / official links</div></div>
      </a>`
        )
        .join("")}</div></section>`
    : "";
  app.innerHTML = `
    <section class="hero">
      <div class="hero-bg" style="background-image:url('${hero?.bannerImage || posterUrl(hero)}')"></div>
      <div class="hero-copy">
        <div class="kicker">Now on Blaze</div>
        <h1>${escapeHtml(titleOf(hero))}</h1>
        <p>${stripHtml(hero.description || "").slice(0, 220)}${(hero.description || "").length > 220 ? "…" : ""}</p>
        <div class="meta-row">
          ${hero.averageScore ? `<span class="chip score">${hero.averageScore}% score</span>` : ""}
          ${hero.status === "RELEASING" ? `<span class="chip live">LIVE SEASON</span>` : ""}
          <span class="chip">${hero.format || "TV"}</span>
          ${(hero.genres || []).slice(0, 3).map((g) => `<span class="chip">${g}</span>`).join("")}
        </div>
        <div class="actions">
          <a class="btn btn-primary" href="#/watch/${hero.id}">▶ Watch trailer</a>
          <a class="btn btn-ghost" href="#/anime/${hero.id}">Details</a>
        </div>
      </div>
    </section>
    ${contCards}
    ${rail("Trending now", trending.media, "#/browse?sort=TRENDING_DESC")}
    ${rail("Live this season", airing.media, "#/live")}
    ${rail(`${season[0] + season.slice(1).toLowerCase()} ${year}`, seasonal.media, "#/browse")}
    ${rail("Most popular", popular.media, "#/browse?sort=POPULARITY_DESC")}
    ${rail("Movies", movies.media, "#/movies")}
  `;
}

async function renderBrowse(params, title, nav, extra = {}) {
  setNav(nav);
  const page = Number(params.get("page") || 1);
  const sort = params.get("sort") || extra.sort || "POPULARITY_DESC";
  const genre = params.get("genre") || extra.genre || undefined;
  const q = params.get("q") || extra.search;
  const isAdult = extra.isAdult ?? (genre === "Hentai");
  app.innerHTML = `<div class="page"><h1>${title}</h1><p class="lede">Full AniList catalog — trailers here, episodes on licensed apps.</p>${skeletons(12)}</div>`;
  const data = await pageMedia({
    page,
    perPage: 30,
    sort: [sort],
    search: q,
    genre,
    isAdult: isAdult ? true : false,
    ...extra.query,
  });
  const genres = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mecha", "Music", "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller", "Hentai"];
  app.innerHTML = `
    <div class="page">
      <h1>${title}</h1>
      <p class="lede">${data.media.length} titles on this page. Browse, search, and open official watch links.</p>
      <div class="filters">
        <select id="sort">
          ${[
            ["POPULARITY_DESC", "Popular"],
            ["TRENDING_DESC", "Trending"],
            ["SCORE_DESC", "Top rated"],
            ["START_DATE_DESC", "Newest"],
          ]
            .map(([v, l]) => `<option value="${v}" ${v === sort ? "selected" : ""}>${l}</option>`)
            .join("")}
        </select>
        <select id="genre">
          <option value="">All genres</option>
          ${genres
            .filter((g) => g !== "Hentai" || ageOk())
            .map((g) => `<option ${g === genre ? "selected" : ""}>${g}</option>`)
            .join("")}
        </select>
      </div>
      <div class="grid">${data.media.map(card).join("") || `<div class="empty">No titles matched.</div>`}</div>
      <div class="actions" style="margin-top:22px">
        ${page > 1 ? `<a class="btn btn-ghost" href="${pageLink(page - 1)}">Previous</a>` : ""}
        ${data.pageInfo.hasNextPage ? `<a class="btn btn-primary" href="${pageLink(page + 1)}">Next page</a>` : ""}
      </div>
    </div>`;

  function pageLink(p) {
    const u = new URL(location.href);
    const sp = new URLSearchParams(location.hash.split("?")[1] || "");
    sp.set("page", p);
    const base = location.hash.split("?")[0];
    return `${base}?${sp.toString()}`;
  }
  document.getElementById("sort").onchange = (e) => {
    const sp = new URLSearchParams(location.hash.split("?")[1] || "");
    sp.set("sort", e.target.value);
    sp.delete("page");
    location.hash = `${location.hash.split("?")[0]}?${sp}`;
  };
  document.getElementById("genre").onchange = (e) => {
    const sp = new URLSearchParams(location.hash.split("?")[1] || "");
    if (e.target.value) sp.set("genre", e.target.value);
    else sp.delete("genre");
    sp.delete("page");
    if (e.target.value === "Hentai" && !ageOk()) {
      location.hash = "#/adult";
      return;
    }
    location.hash = `${location.hash.split("?")[0]}?${sp}`;
  };
}

async function renderDetail(id) {
  setNav("browse");
  app.innerHTML = `<div class="page">${skeletons(4)}</div>`;
  const m = await getAnime(id);
  if (!m || !safe(m) || (m.isAdult && !ageOk())) {
    app.innerHTML = `<div class="page"><h1>Unavailable</h1><p class="lede">This title is blocked or needs 18+ confirmation.</p></div>`;
    return;
  }
  const links = streamingLinks(m);
  const related = (m.relations?.edges || [])
    .filter((e) => e.node?.type === "ANIME" && (!e.node.isAdult || ageOk()))
    .slice(0, 10);
  app.innerHTML = `
    <div class="page">
      <div class="detail">
        <div class="cover"><img src="${posterUrl(m)}" alt="${escapeHtml(titleOf(m))}" /></div>
        <div>
          <div class="kicker">${m.isAdult ? "18+ ADULT" : "ANIME"}</div>
          <h1>${escapeHtml(titleOf(m))}</h1>
          <div class="meta-row">
            ${m.averageScore ? `<span class="chip score">${m.averageScore}</span>` : ""}
            ${m.status === "RELEASING" ? `<span class="chip live">LIVE</span>` : `<span class="chip">${m.status || ""}</span>`}
            <span class="chip">${m.format || ""}</span>
            <span class="chip">${m.episodes || "?"} eps</span>
            ${(m.genres || []).map((g) => `<span class="chip">${g}</span>`).join("")}
          </div>
          <p class="synopsis">${stripHtml(m.description || "No synopsis yet.")}</p>
          <div class="actions">
            <a class="btn btn-primary" href="#/watch/${m.id}">▶ Watch trailer</a>
            <button class="btn btn-ghost" id="list-btn">${inList(m.id) ? "✓ In My List" : "+ My List"}</button>
          </div>
          <h3>Watch legally</h3>
          <div class="stream-links">
            ${
              links.length
                ? links.map((l) => `<a href="${l.url}" target="_blank" rel="noopener">${escapeHtml(l.site)}</a>`).join("")
                : `<span class="sub">No licensed stream link on file. Trailer still available when publishers uploaded one.</span>`
            }
          </div>
        </div>
      </div>
      ${related.length ? rail("Related", related.map((e) => e.node)) : ""}
    </div>`;
  document.getElementById("list-btn").onclick = () => {
    toggleList(m.id);
    renderDetail(id);
  };
}

async function renderWatch(id) {
  setNav("home");
  app.innerHTML = `<div class="page">${skeletons(3)}</div>`;
  const m = await getAnime(id);
  if (!m || !safe(m) || (m.isAdult && !ageOk())) {
    app.innerHTML = `<div class="page"><h1>Player locked</h1><p class="lede">Confirm 18+ to open adult titles. Blocked tags never play.</p></div>`;
    return;
  }
  const src = trailerSrc(m.trailer);
  const links = streamingLinks(m);
  const episodes = m.streamingEpisodes || [];
  const cont = load(STORE.continue, []).filter((x) => x.id !== m.id);
  cont.unshift({ id: m.id, title: titleOf(m), cover: posterUrl(m) });
  save(STORE.continue, cont.slice(0, 24));

  app.innerHTML = `
    <div class="page">
      <div class="player-wrap">
        ${
          src
            ? `<iframe src="${src}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="${escapeHtml(titleOf(m))} trailer"></iframe>`
            : `<div class="player-empty"><div><h2>No trailer on file</h2><p>Open a licensed service below for full episodes.</p></div></div>`
        }
      </div>
      <h1 style="margin-top:18px">${escapeHtml(titleOf(m))}</h1>
      <p class="lede">In-player video is the official trailer/preview. Full episodes stay on Crunchyroll and other licensed platforms — Blaze does not host pirated streams.</p>
      <div class="stream-links">
        ${links.map((l) => `<a href="${l.url}" target="_blank" rel="noopener">Watch on ${escapeHtml(l.site)}</a>`).join("")}
        <a class="btn btn-ghost" href="#/anime/${m.id}">Details</a>
      </div>
      ${
        episodes.length
          ? `<h2>Official episode links</h2>
             <div class="episodes">${episodes
               .slice(0, 40)
               .map(
                 (ep) => `
               <a class="ep" href="${ep.url}" target="_blank" rel="noopener">
                 <img src="${ep.thumbnail || posterUrl(m)}" alt="" />
                 <div><strong>${escapeHtml(ep.title || "Episode")}</strong><div class="sub">${escapeHtml(ep.site || "Official")}</div></div>
                 <span class="chip">Open</span>
               </a>`
               )
               .join("")}</div>`
          : ""
      }
    </div>`;
}

async function renderList() {
  setNav("list");
  const ids = load(STORE.list, []);
  app.innerHTML = `<div class="page"><h1>My List</h1>${skeletons(6)}</div>`;
  if (!ids.length) {
    app.innerHTML = `<div class="page"><h1>My List</h1><p class="empty">Save shows from any title page.</p></div>`;
    return;
  }
  const items = [];
  for (const id of ids.slice(0, 30)) {
    try {
      const m = await getAnime(id);
      if (m && safe(m) && (!m.isAdult || ageOk())) items.push(m);
    } catch {
      /* skip missing ids */
    }
  }
  app.innerHTML = `<div class="page"><h1>My List</h1><div class="grid">${items.map(card).join("")}</div></div>`;
}

async function route() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, queryString] = raw.split("?");
  const params = new URLSearchParams(queryString || "");
  const parts = path.split("/").filter(Boolean);
  try {
    if (parts[0] === "adult") {
      if (!ageOk()) {
        ageGate.classList.remove("hidden");
        app.innerHTML = `<div class="page"><h1>18+ Adult</h1><p class="lede">Confirm your age to browse adult anime, including hentai catalog entries. Minors-related tags are excluded.</p></div>`;
        return;
      }
      await renderBrowse(params, "18+ Adult & Hentai", "adult", { isAdult: true, query: { isAdult: true } });
      return;
    }
    if (parts[0] === "browse") return renderBrowse(params, "Browse all anime", "browse");
    if (parts[0] === "live") {
      return renderBrowse(params, "Live now — currently airing", "live", {
        query: { status: "RELEASING", sort: ["TRENDING_DESC"] },
        sort: "TRENDING_DESC",
      });
    }
    if (parts[0] === "movies") {
      return renderBrowse(params, "Movies", "movies", { query: { format: "MOVIE" } });
    }
    if (parts[0] === "search" && parts[1]) {
      searchInput.value = decodeURIComponent(parts[1]);
      return renderBrowse(params, `Results for “${decodeURIComponent(parts[1])}”`, "browse", {
        search: decodeURIComponent(parts[1]),
      });
    }
    if (parts[0] === "anime" && parts[1]) return renderDetail(parts[1]);
    if (parts[0] === "watch" && parts[1]) return renderWatch(parts[1]);
    if (parts[0] === "list") return renderList();
    await renderHome();
  } catch (err) {
    app.innerHTML = `<div class="page"><h1>Catalog hiccup</h1><p class="lede">${escapeHtml(err.message)}. Refresh in a moment — AniList rate-limits heavy browsing.</p></div>`;
  }
}

window.addEventListener("hashchange", route);
route();
