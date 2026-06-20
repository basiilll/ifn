// IFN profile option lists (ported from the original tags.js). Reused by register,
// profile edit, and the directory filters.
// REGIONS = all Indian states + union territories (alphabetical). The region picker is a
// combobox, so members can also type a value that isn't on the list.
export const REGIONS = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]
// Sectors span all four colleges (tech, business, law, architecture), so a tech-only
// list doesn't dump every law/architecture/MBA founder into "Other". The pickers are
// searchable comboboxes and accept a custom value, so this list can stay broad.
export const SECTORS = [
  'FinTech', 'EdTech', 'HealthTech', 'AgriTech', 'FoodTech', 'ClimateTech & Energy',
  'Mobility', 'Logistics & Supply Chain', 'E-commerce & Retail', 'Consumer/D2C',
  'Media & Gaming', 'Real Estate & PropTech', 'Construction & Architecture',
  'LegalTech & Compliance', 'GovTech & Policy', 'Manufacturing',
  'Hospitality & Travel', 'Professional Services', 'Social Impact',
  'DeepTech & Robotics', 'CyberSecurity', 'Other',
]
// Domain = what you build / business model (not industry). Includes non-software
// build types (Physical Product, Services) for law/architecture/business founders.
export const DOMAINS = [
  'AI/ML', 'Web/SaaS', 'Mobile App', 'Marketplace', 'Hardware/IoT',
  'Physical Product', 'Services/Consulting', 'Content/Media', 'Platform',
  'Blockchain/Web3', 'Other',
]
// MEMBER_TYPES = the "registering as" label picked on the registration form and shown as a
// badge. Descriptive label only, NOT a permission role (those stay student/mentor/admin).
export const MEMBER_TYPES = [
  'Founder', 'Student', 'Mentor', 'Investor', 'Network Enabler', 'Service Provider', 'Incubator', 'Other',
]
// Suggested permission level for a member_type. Only "Mentor" implies elevated access; every
// other label is a regular member. Admin access is never derived from a label. Used to
// auto-fill (with override) the permission control when an admin assigns a member_type.
export function typeToRole(memberType) {
  return memberType === 'Mentor' ? 'mentor' : 'student'
}
