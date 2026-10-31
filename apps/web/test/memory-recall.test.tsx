import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRecall } from "../src/chat/MemoryRecall.tsx";

test("disclosure starts collapsed with accessible control and preserved plain text", () => {
 const html = renderToStaticMarkup(<MemoryRecall items={[{content:"<script>not executable</script>", scope:"project", saved:"2026-10-30"}, {}]} />);
 expect(html).toContain("전달된 기억 2개");
 expect(html).toContain('aria-expanded="false"');
 expect(html).toContain("aria-controls=");
 expect(html).toContain("hidden=");
 expect(html).toContain("&lt;script&gt;not executable&lt;/script&gt;");
 expect(html).not.toContain("<script>");
 expect(html).toContain("2026-10-30");
 expect(html).toContain("이 기록에는 전달 당시의 기억 내용이 없어요.");
});

test("empty record is a truthful zero count with explicit empty detail", () => {
 const html = renderToStaticMarkup(<MemoryRecall items={[]} />);
 expect(html).toContain("전달된 기억 0개");
 expect(html).toContain("전달된 기억이 없어요.");
});
