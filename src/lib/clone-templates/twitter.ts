// Twitter (X) clone — pre-baked CloneSpec used when the user voice-commands
// "build a Twitter clone". Materialized client-side via cloneCompiler.
// All persistence is localStorage; no upstream calls.

import type { CloneSpec } from "@/lib/cloneSpec";

export const TWITTER_CLONE: CloneSpec = {
  id: "twitter-clone",
  name: "Chirp",
  inspiration: "Twitter",
  icon: "MessageCircle",
  branding: { primary: "#1d9bf0", secondary: "#0f1419", font: "Inter" },
  storage: "localStorage",
  auth: "none",
  features: ["feed", "compose", "like", "repost", "follow", "profile", "search"],
  models: [
    {
      name: "User",
      fields: [
        { name: "id", type: "id" },
        { name: "handle", type: "string" },
        { name: "displayName", type: "string" },
        { name: "bio", type: "string" },
        { name: "followers", type: "number" },
        { name: "following", type: "number" },
      ],
    },
    {
      name: "Post",
      fields: [
        { name: "id", type: "id" },
        { name: "authorId", type: "reference", refTo: "User" },
        { name: "text", type: "string" },
        { name: "createdAt", type: "date" },
        { name: "likes", type: "number" },
        { name: "reposts", type: "number" },
      ],
    },
  ],
  apis: [
    { path: "/post/list", method: "GET" },
    { path: "/post/create", method: "POST" },
    { path: "/post/like", method: "POST" },
    { path: "/user/me", method: "GET" },
    { path: "/user/search", method: "GET" },
  ],
  pages: [
    {
      id: "home",
      path: "/",
      title: "Home",
      layout: "sidebar",
      root: {
        kind: "col",
        gap: 3,
        children: [
          { kind: "text", value: "Chirp · Home", size: "h2" },
          { kind: "input", bind: "compose", placeholder: "What's happening?" },
          { kind: "button", label: "Chirp", variant: "primary", actions: [{ kind: "push", listKey: "posts", valueTemplate: "{{compose}}" }, { kind: "set", key: "compose", value: "" }] },
          { kind: "divider" },
          { kind: "list", bindKey: "posts", itemTemplate: "{{item}}", emptyText: "no chirps yet — compose one above" },
        ],
      },
    },
    {
      id: "profile",
      path: "/profile",
      title: "Profile",
      layout: "full",
      root: {
        kind: "col",
        gap: 3,
        children: [
          { kind: "text", value: "@you", size: "h1" },
          { kind: "text", value: "Bio: agent that flows under pressure", size: "body" },
          { kind: "text", value: "Posts: {{posts.length}}", size: "body" },
        ],
      },
    },
  ],
};
