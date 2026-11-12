const groups = [
  /product|san pham|strategie|strategy/,
  /engineer|develop|architect|code|lap trinh|ky thuat/,
  /growth|market|sales|tang truong|tiep thi/,
  /research|analyst|science|nghien cuu|phan tich/,
  /design|visual|thiet ke/,
  /operation|supply|manufactur|van hanh/,
  /teach|educat|coach|giao duc|giao vien/,
  /health|medical|fitness|psych|suc khoe|y te/,
  /financ|invest|account|tai chinh|ke toan/,
  /legal|law|compliance|phap ly|luat/,
  /writ|creativ|editor|content|bien tap|sang tao/,
];

export function profileAvatarClass(name = '') {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replaceAll('đ', 'd');
  const group = groups.findIndex(pattern => pattern.test(normalized));
  return 'profile-portrait portrait-' + (group < 0 ? 11 : group);
}
