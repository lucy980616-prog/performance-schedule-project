import type { NextConfig } from "next";

// GitHub Pages는 https://<user>.github.io/<repo>/ 아래에 서빙되므로
// 리포지토리 이름을 basePath로 붙여야 링크/에셋 경로가 깨지지 않는다.
// 로컬 개발(next dev)에서는 비워 둔다.
const repo = "performance-schedule-project";
const isGithubPages = process.env.GITHUB_PAGES === "1";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  basePath: isGithubPages ? `/${repo}` : "",
  assetPrefix: isGithubPages ? `/${repo}/` : "",
};

export default nextConfig;
