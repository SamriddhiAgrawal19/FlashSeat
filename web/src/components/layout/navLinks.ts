export interface NavItem {
  label: string;
  to: string;
}

/** Primary site navigation, shared by the navbar, the mobile menu and the footer. */
export const NAV_LINKS: NavItem[] = [
  { label: 'Explore', to: '/events' },
  { label: 'Categories', to: '/#categories' },
  { label: 'For organizers', to: '/#organizers' },
];

export const GITHUB_URL = 'https://github.com/SamriddhiAgrawal19/FlashSeat';
