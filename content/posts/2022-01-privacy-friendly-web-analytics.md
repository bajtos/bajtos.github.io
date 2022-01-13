---
title: Privacy-friendly web analytics that works in the Brave browser
date: 2022-01-14
---

For my blog, I have the following requirements for web analytics:

1. Respect the privacy of my readers. Don't let Big Tech track their behaviour
   and link it with other online activities. (Looking at you, Google Analytics!)

2. Collect website visits from tech-savvy users. The Brave browser and various
   ad-block plugins are automatically blocking requests to well-known web
   analytics API backends.

3. Nice to have: Don't mix real visitors with page visits I make while
   previewing a new version of my site.

I was able to get all these features from [Plausible](https://plausible.io/):

1. Plausible is extremely focused on privacy. They are minimizing data
   collection and don't collect any personal information. There are no cookies,
   no tracking across devices, websites or apps.

2. Plausible offers a well-documented solution for using a proxy to avoid
   content blockers.

3. After a bit of searching, I found an easy way how to customize which domain
   name is reported by my website. This way I can distinguish between visits to
   the live website and preview sites.

## My setup

I am using [Hugo](https://gohugo.io) for generating my website and
[Netlify](https://netlify.com) to build & serve the content. Here is how I
implemented tracking:

1. In my Hugo templates, I added a `<script>` tag to fetch Plausible client-side
   script. To avoid content-blockers, I am fetching the script from an URL on my
   own domain: [/s/main.js](/s/main.js). Under the hood, Netlify handles this
   endpoint by fetching the response from Plausible.
2. I configured the Plausible client to post events to an URL on my own domain
   too: [/s/event](/s/event). This endpoint is again proxied by Netlify to
   Plausible.
3. Finally, I have a small script to detect Netlify preview domains and tell the
   Plausible client to report a different domain name to the data collector.

Let's start with the script setting up Plausible client. I am adding it as the
last child of the `<head>` element in all my pages.

```html
<script>
  const host = window.location.host;
  const site = host === 'bajtos.net' ? 'bajtos.net' : 'preview.bajtos.net';
  const tag = document.createElement('script');
  tag.defer = true;
  // Where to fetch Plausible client-side script from
  tag.src = '/s/main.js';
  // Where to post events to
  tag.setAttribute('data-api', '/s/event');
  // What site to report
  tag.setAttribute('data-domain', site);
  document.head.appendChild(tag);
</script>
```

Here is the relevant part of my `netlify.toml` file where I configure proxy
rules:

```toml
[[redirects]]
  from = "/s/main.js"
  to = "https://plausible.io/js/plausible.js"
  status = 200

[[redirects]]
  from = "/s/event"
  to = "https://plausible.io/api/event"
  status = 202
```

Pretty simple, isn't it?

You can learn more about Plausible in their docs:

- [Plausible: Privacy focused Google Analytics alternative](https://plausible.io/privacy-focused-web-analytics)
- [Adblockers and using a proxy for analytics](https://plausible.io/docs/proxy/introduction)
