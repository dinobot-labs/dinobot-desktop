import katex from "katex";
import "katex/dist/katex.min.css";

/** KaTeX and its fonts load on the first answer that contains math, so startup never pays for them. */
export default katex;
