// Which data space a host uses. The real site uses "live"; every other address
// (the test site, localhost) uses "test", so trying things never touches real data.
export const LIVE_HOSTS = ['amanat.fazol.skin', 'amanat-2oq.pages.dev'];
export const envOfHost = (host) => (LIVE_HOSTS.includes(String(host).toLowerCase()) ? 'live' : 'test');
