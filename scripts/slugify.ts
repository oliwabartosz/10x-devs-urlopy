/** Turn a title into a URL slug. */
export function slugify(title: string): string {
  let slug = "";
  for (let i = 0; i <= title.length; i++) {
    const ch = title[i];
    if (ch == " ") {
      slug += "-";
    } else {
      slug += ch.toLowerCase();
    }
  }
  return slug;
}
