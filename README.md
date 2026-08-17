# Blaze Anime

Crunchyroll-style anime catalog you can browse, search, and preview.

Blaze pulls the public AniList catalog (tens of thousands of titles), plays **official trailers**, and sends you to **licensed** full-episode services such as Crunchyroll, Netflix, and HIDIVE.

It does **not** host or scrape pirated episode streams.

## Features

- Home hero, trending, seasonal, movies, and currently airing (“Live Now”)
- Search and paginated browse across the AniList anime catalog
- Title pages with synopsis, scores, related shows, and official watch links
- Trailer player (YouTube / Dailymotion)
- My List + Continue watching (saved in your browser)
- Optional **18+ / hentai** catalog behind an age gate
- Titles tagged Loli / Shota (and similar) are blocked

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
npx --yes serve .
```

Then visit the URL printed in the terminal (usually http://localhost:3000).

## Deploy (GitHub Pages)

1. Push this repo.
2. Settings → Pages → Deploy from branch `main` / root.
3. Site URL: `https://<your-username>.github.io/blaze-anime/`

## Adult section

`#/adult` asks you to confirm you are 18+. Adult metadata comes from AniList (`isAdult` / Hentai genre). Full adult videos still only play where a publisher provided a trailer or a licensed external link.

## Credits

Catalog © their respective owners. Data via [AniList GraphQL API](https://docs.anilist.co/).
