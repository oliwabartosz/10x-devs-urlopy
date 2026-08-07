// Avatar palette for initials chips (new-design/10xUrlopy.dc.html:871, :934).
//
// Colour is index-derived, so it must always be indexed off an employees array that has
// already been through visibleEmployeesFilter() — never a fresh query, or the is_system
// admin shifts everyone's colour and becomes visible by its absence
// (context/changes/admin-bootstrap/plan.md).
export const AVATAR_COLORS = ["#2f578c", "#58873e", "#82368C", "#cc654e", "#0b5a72"] as const;

export function avatarColor(index: number): string {
  if (index < 0) return "#9a9a9a";
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}
