/* tc-auth.js — Real Supabase authentication. Requires the Supabase UMD
   CDN script (https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.js,
   pinned with a Subresource Integrity hash — see Global Constraints)
   to be loaded on the page BEFORE this file, so window.supabase exists. */
window.TcAuth = (() => {
  const SUPABASE_URL = 'https://cfuxiifpvuzvysjxztax.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_QlnEC8AOsbV3oVlLbojpTg_9I137qgM';

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function homeUrl() {
    return location.origin + location.pathname.replace(/[^/]+$/, 'home.html');
  }
  function loginUrl() {
    return location.origin + location.pathname.replace(/[^/]+$/, 'login.html');
  }

  async function signUp(email, password, displayName) {
    const { data, error } = await client.auth.signUp({
      email, password,
      options: { data: { display_name: displayName } }
    });
    if (error) throw error;
    return data;
  }

  async function signInWithPassword(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signInWithOAuth(provider) {
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: homeUrl() }
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  async function getSession() {
    const { data, error } = await client.auth.getSession();
    if (error) return null;
    return data.session;
  }

  async function requireAuth() {
    const session = await getSession();
    if (!session) {
      window.location.href = loginUrl();
    }
    return session;
  }

  return { client, signUp, signInWithPassword, signInWithOAuth, signOut, getSession, requireAuth };
})();
