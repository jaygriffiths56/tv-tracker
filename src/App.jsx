import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://haslltdrvkslsocmqsjd.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhhc2xsdGRydmtzbHNvY21xc2pkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwODk3MTQsImV4cCI6MjA4ODY2NTcxNH0.W4XsnrSfUXRBpmCC1G51oGsM0oPR-EFCPsbmjdSqyuU"
);

const SHOW_COLORS = [
  "#FF6B6B","#4ECDC4","#FFE66D","#A8E6CF","#FF8B94",
  "#B8B8FF","#FFDAC1","#C7CEEA","#F9A8D4","#80CBC4",
];
const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const DAY_SHORT = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const TVDB_IMG = "https://artworks.thetvdb.com";

function epKey(s, e) { return `${s}-${e}`; }
function getNextEpisode(show) {
  if (!show.seasons) return null;
  for (const season of show.seasons)
    for (const ep of season.episodes)
      if (!show.watched?.[epKey(season.number, ep.n)])
        return { season: season.number, episode: ep.n, title: ep.title };
  return null;
}
function getTotalEpisodes(show) { return show.seasons?.reduce((a, s) => a + s.episodes.length, 0) ?? 0; }
function getWatchedCount(show) { return Object.values(show.watched || {}).filter(Boolean).length; }
function fixPoster(url) {
  if (!url) return null;
  return url.startsWith("http") ? url : `${TVDB_IMG}${url}`;
}

function LoadingDots({ color = "#8080ff" }) {
  return (
    <span style={{ display:"inline-flex", gap:4, alignItems:"center" }}>
      {[0,1,2].map(i => (
        <span key={i} style={{ width:5, height:5, borderRadius:"50%", background:color,
          animation:`dot-pulse 1.2s ease-in-out ${i*0.2}s infinite` }}/>
      ))}
    </span>
  );
}

// ── TVDB API ──────────────────────────────────────────────────────────────────

let tvdbTokenCache = null;
async function tvdbLogin() {
  if (tvdbTokenCache) return tvdbTokenCache;
  const res = await fetch("https://api4.thetvdb.com/v4/login", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ apikey:"8bd1a8a0-a7af-42c1-a819-4c8a87a5c09c" }),
  });
  if (!res.ok) throw new Error(`TVDB login failed: ${res.status}`);
  const data = await res.json();
  tvdbTokenCache = data.data.token;
  return tvdbTokenCache;
}

async function searchShows(query) {
  const token = await tvdbLogin();
  const headers = { Authorization: `Bearer ${token}` };
  const res = await fetch(
    `https://api4.thetvdb.com/v4/search?query=${encodeURIComponent(query)}&type=series&limit=8`,
    { headers }
  );
  if (!res.ok) throw new Error(`TVDB search failed: ${res.status}`);
  const data = await res.json();
  if (!data.data?.length) throw new Error(`No results found for "${query}"`);
  return data.data.map(s => ({
    tvdb_id: s.tvdb_id,
    title: s.name,
    network: s.network || "Unknown",
    year: s.first_air_time ? s.first_air_time.slice(0,4) : "?",
    genre: s.genres?.[0] || "",
    overview: s.overview ? s.overview.slice(0,160) + (s.overview.length > 160 ? "..." : "") : "",
    poster: fixPoster(s.image_url),
  }));
}

async function fetchShowById(tvdbId) {
  const token = await tvdbLogin();
  const headers = { Authorization: `Bearer ${token}` };
  const seriesId = tvdbId;

  const extRes = await fetch(
    `https://api4.thetvdb.com/v4/series/${seriesId}/extended?meta=translations`,
    { headers }
  );
  if (!extRes.ok) throw new Error(`TVDB series lookup failed: ${extRes.status}`);
  const series = (await extRes.json()).data;

  let page = 0, allEpisodes = [];
  while (true) {
    const epRes = await fetch(
      `https://api4.thetvdb.com/v4/series/${seriesId}/episodes/default?page=${page}`,
      { headers }
    );
    if (!epRes.ok) break;
    const eps = (await epRes.json()).data?.episodes ?? [];
    if (!eps.length) break;
    allEpisodes = allEpisodes.concat(eps);
    if (eps.length < 100) break;
    page++;
  }

  const seasonMap = {};
  for (const ep of allEpisodes) {
    const sNum = ep.seasonNumber;
    if (sNum === 0) continue;
    if (!seasonMap[sNum]) seasonMap[sNum] = [];
    seasonMap[sNum].push({ n: ep.number, title: ep.name || `Episode ${ep.number}` });
  }
  const seasons = Object.keys(seasonMap).map(Number).sort((a,b) => a-b)
    .map(num => ({ number:num, episodes:seasonMap[num].sort((a,b) => a.n-b.n) }));

  const network = series.companies?.find(c => c.companyType?.companyTypeId === 1)?.name
    ?? series.originalNetwork?.name ?? "Unknown";
  const airDay = series.airsDays
    ? Object.entries(series.airsDays).find(([,v]) => v === true)?.[0] ?? "Unknown"
    : "Unknown";
  const airDayFormatted = airDay.charAt(0).toUpperCase() + airDay.slice(1);
  const genre = series.genres?.[0]?.name ?? "Drama";
  const poster = fixPoster(series.image);

  return {
    tvdb_id: String(seriesId), title: series.name, platform: network,
    airDay: airDayFormatted, time: series.airsTime ? `${series.airsTime} ET` : "",
    genre, seasons, poster,
  };
}

// ── Set New Password Screen ───────────────────────────────────────────────────

function SetNewPasswordScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    if (!password.trim() || password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setDone(true);
    setTimeout(onDone, 2000);
  }

  const inputStyle = { background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:9, padding:"11px 14px", fontSize:14, color:"#e0e0f0", width:"100%" };

  return (
    <div style={{ minHeight:"100vh", background:"#0c0c14", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=DM+Serif+Display&display=swap'); @keyframes dot-pulse{0%,100%{opacity:.3;transform:scale(.7)}50%{opacity:1;transform:scale(1)}} *{box-sizing:border-box;margin:0;padding:0} input:focus{outline:none;border-color:#6060c0!important} button{cursor:pointer;font-family:inherit}`}</style>
      <div style={{ width:"100%", maxWidth:400, padding:"0 24px" }}>
        <h1 style={{ fontFamily:"'DM Serif Display',serif", fontSize:32, color:"#fff", textAlign:"center", marginBottom:8 }}>Set New Password</h1>
        <p style={{ color:"#3a3a5a", fontSize:13, textAlign:"center", marginBottom:36 }}>Choose a new password for your account</p>
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:"28px 24px" }}>
          {done ? (
            <div style={{ padding:"16px", background:"rgba(80,200,80,0.09)", border:"1px solid rgba(80,200,80,0.2)", borderRadius:8, fontSize:14, color:"#80d080", textAlign:"center" }}>
              Password updated! Signing you in...
            </div>
          ) : (
            <>
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="New password" style={inputStyle}/>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key==="Enter" && handleSubmit()} placeholder="Confirm new password" style={inputStyle}/>
              </div>
              {error && <div style={{ marginTop:12, padding:"10px 14px", background:"rgba(255,80,80,0.09)", border:"1px solid rgba(255,80,80,0.2)", borderRadius:8, fontSize:13, color:"#ff8888" }}>{error}</div>}
              <button onClick={handleSubmit} disabled={loading || !password.trim() || !confirm.trim()}
                style={{ marginTop:18, width:"100%", background:loading||!password.trim()?"#181830":"#5050d0", color:"#fff", border:"none", borderRadius:9, padding:"12px 0", fontSize:14, fontWeight:600 }}>
                {loading ? <LoadingDots/> : "Set Password"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Auth Screen ───────────────────────────────────────────────────────────────

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resetMode, setResetMode] = useState(false);

  async function handleSubmit() {
    if (resetMode) {
      if (!email.trim()) return;
      setLoading(true); setError("");
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      setLoading(false);
      if (error) setError(error.message);
      else setMessage("Password reset email sent. Check your inbox.");
      return;
    }
    if (!email.trim() || !password.trim()) return;
    if (mode === "signup" && !displayName.trim()) return;
    setLoading(true); setError(""); setMessage("");
    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth(data.session);
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user) await supabase.from("profiles").insert({ id: data.user.id, display_name: displayName.trim() });
        setMessage("Account created! You can now log in.");
        setMode("login");
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  const inputStyle = { background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:9, padding:"11px 14px", fontSize:14, color:"#e0e0f0", width:"100%" };
  const baseStyles = `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=DM+Serif+Display&display=swap'); @keyframes dot-pulse{0%,100%{opacity:.3;transform:scale(.7)}50%{opacity:1;transform:scale(1)}} *{box-sizing:border-box;margin:0;padding:0} input:focus{outline:none;border-color:#6060c0!important} button{cursor:pointer;font-family:inherit}`;

  if (resetMode) return (
    <div style={{ minHeight:"100vh", background:"#0c0c14", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>
      <style>{baseStyles}</style>
      <div style={{ width:"100%", maxWidth:400, padding:"0 24px" }}>
        <h1 style={{ fontFamily:"'DM Serif Display',serif", fontSize:32, color:"#fff", textAlign:"center", marginBottom:8 }}>Reset Password</h1>
        <p style={{ color:"#3a3a5a", fontSize:13, textAlign:"center", marginBottom:36 }}>Enter your email and we will send a reset link</p>
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:"28px 24px" }}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key==="Enter" && handleSubmit()} placeholder="Email" style={inputStyle}/>
          {error && <div style={{ marginTop:12, padding:"10px 14px", background:"rgba(255,80,80,0.09)", border:"1px solid rgba(255,80,80,0.2)", borderRadius:8, fontSize:13, color:"#ff8888" }}>{error}</div>}
          {message && <div style={{ marginTop:12, padding:"10px 14px", background:"rgba(80,200,80,0.09)", border:"1px solid rgba(80,200,80,0.2)", borderRadius:8, fontSize:13, color:"#80d080" }}>{message}</div>}
          <button onClick={handleSubmit} disabled={loading || !email.trim()} style={{ marginTop:18, width:"100%", background:loading||!email.trim()?"#181830":"#5050d0", color:"#fff", border:"none", borderRadius:9, padding:"12px 0", fontSize:14, fontWeight:600 }}>{loading ? <LoadingDots/> : "Send Reset Link"}</button>
          <button onClick={() => setResetMode(false)} style={{ marginTop:12, width:"100%", background:"transparent", border:"none", color:"#4a4a6a", fontSize:13 }}>Back to Log In</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#0c0c14", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>
      <style>{baseStyles}</style>
      <div style={{ width:"100%", maxWidth:400, padding:"0 24px" }}>
        <h1 style={{ fontFamily:"'DM Serif Display',serif", fontSize:32, color:"#fff", textAlign:"center", marginBottom:8 }}>TV Show Tracker</h1>
        <p style={{ color:"#3a3a5a", fontSize:13, textAlign:"center", marginBottom:36 }}>Track your shows across every device</p>
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:"28px 24px" }}>
          <div style={{ display:"flex", marginBottom:24, background:"rgba(255,255,255,0.04)", borderRadius:8, padding:3 }}>
            {[["login","Log In"],["signup","Sign Up"]].map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setError(""); setMessage(""); }}
                style={{ flex:1, background:mode===m?"rgba(255,255,255,0.08)":"transparent", border:"none", color:mode===m?"#fff":"#4a4a6a", borderRadius:6, padding:"7px 0", fontSize:13, fontWeight:500 }}>{label}</button>
            ))}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {mode === "signup" && <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Display name (shown to others)" style={inputStyle}/>}
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key==="Enter" && handleSubmit()} placeholder="Email" style={inputStyle}/>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key==="Enter" && handleSubmit()} placeholder="Password" style={inputStyle}/>
          </div>
          {error && <div style={{ marginTop:12, padding:"10px 14px", background:"rgba(255,80,80,0.09)", border:"1px solid rgba(255,80,80,0.2)", borderRadius:8, fontSize:13, color:"#ff8888" }}>{error}</div>}
          {message && <div style={{ marginTop:12, padding:"10px 14px", background:"rgba(80,200,80,0.09)", border:"1px solid rgba(80,200,80,0.2)", borderRadius:8, fontSize:13, color:"#80d080" }}>{message}</div>}
          <button onClick={handleSubmit} disabled={loading || !email.trim() || !password.trim() || (mode==="signup" && !displayName.trim())}
            style={{ marginTop:18, width:"100%", background:loading||!email.trim()||!password.trim()?"#181830":"#5050d0", color:"#fff", border:"none", borderRadius:9, padding:"12px 0", fontSize:14, fontWeight:600 }}>
            {loading ? <LoadingDots/> : mode==="login" ? "Log In" : "Create Account"}
          </button>
          {mode === "login" && (
            <button onClick={() => setResetMode(true)} style={{ marginTop:10, width:"100%", background:"transparent", border:"none", color:"#4a4a6a", fontSize:12, padding:"4px 0" }}>Forgot password?</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Settings Panel ────────────────────────────────────────────────────────────

function SettingsPanel({ session, profile, onProfileUpdate, onClose }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || "");
  const [shareCode, setShareCode] = useState("");
  const [following, setFollowing] = useState([]);
  const [saving, setSaving] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [copied, setCopied] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    const { data: prof } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
    if (prof) setDisplayName(prof.display_name);
    const { data: follows } = await supabase.from("show_followers").select("following_id").eq("follower_id", session.user.id);
    if (follows?.length) {
      const { data: profiles } = await supabase.from("profiles").select("*").in("id", follows.map(f => f.following_id));
      setFollowing(profiles || []);
    }
  }

  async function saveDisplayName() {
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ display_name: displayName.trim() }).eq("id", session.user.id);
    setSaving(false);
    if (!error) { onProfileUpdate({ ...profile, display_name: displayName.trim() }); setSaveMsg("Saved!"); setTimeout(() => setSaveMsg(""), 2000); }
  }

  async function joinByCode() {
    if (!shareCode.trim()) return;
    setJoining(true); setJoinError("");
    const code = shareCode.trim().toUpperCase();
    const { data: targetProfile } = await supabase.from("profiles").select("*").eq("share_code", code).single();
    if (!targetProfile) { setJoinError("Code not found. Check and try again."); setJoining(false); return; }
    if (targetProfile.id === session.user.id) { setJoinError("That is your own code."); setJoining(false); return; }
    const { error } = await supabase.from("show_followers").upsert({ follower_id: session.user.id, following_id: targetProfile.id });
    if (error) { setJoinError("Already following this person."); } else { setFollowing(prev => [...prev.filter(f => f.id !== targetProfile.id), targetProfile]); setShareCode(""); }
    setJoining(false);
  }

  async function unfollow(userId) {
    await supabase.from("show_followers").delete().eq("follower_id", session.user.id).eq("following_id", userId);
    setFollowing(prev => prev.filter(f => f.id !== userId));
  }

  function copyShareLink() {
    navigator.clipboard.writeText(`${window.location.origin}?code=${profile?.share_code}`);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  const card = (extra = {}) => ({ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, ...extra });

  return (
    <div style={{ animation:"fadeIn .2s ease" }}>
      <button onClick={onClose} style={{ background:"transparent", border:"none", color:"#4a4a6a", fontSize:13, marginBottom:22, display:"flex", alignItems:"center", gap:6, padding:0, cursor:"pointer" }}>&larr; Back</button>
      <h2 style={{ fontFamily:"'DM Serif Display',serif", fontSize:22, color:"#fff", marginBottom:24 }}>Settings</h2>
      <div style={{ display:"flex", flexDirection:"column", gap:16, maxWidth:500 }}>
        <div style={{ ...card({ padding:"18px 20px" }) }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#4a4a6a", letterSpacing:"1px", textTransform:"uppercase", marginBottom:12 }}>Display Name</div>
          <div style={{ display:"flex", gap:10 }}>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} style={{ flex:1, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:8, padding:"9px 12px", fontSize:14, color:"#e0e0f0" }}/>
            <button onClick={saveDisplayName} disabled={saving || !displayName.trim()} style={{ background:"#5050d0", color:"#fff", border:"none", borderRadius:8, padding:"9px 16px", fontSize:13, fontWeight:600 }}>{saving ? <LoadingDots/> : saveMsg || "Save"}</button>
          </div>
        </div>
        <div style={{ ...card({ padding:"18px 20px" }) }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#4a4a6a", letterSpacing:"1px", textTransform:"uppercase", marginBottom:12 }}>Your Share Code</div>
          <div style={{ fontSize:13, color:"#6a6a8a", marginBottom:12, lineHeight:1.6 }}>Share this code or link with others so they can see your shared shows.</div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ flex:1, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"10px 14px", fontSize:18, fontWeight:700, letterSpacing:"4px", color:"#8080ff", textAlign:"center" }}>{profile?.share_code || "..."}</div>
            <button onClick={copyShareLink} style={{ background:copied?"rgba(80,200,80,0.15)":"rgba(255,255,255,0.06)", border:copied?"1px solid rgba(80,200,80,0.3)":"1px solid rgba(255,255,255,0.1)", color:copied?"#80d080":"#8080c0", borderRadius:8, padding:"10px 16px", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>{copied ? "Copied!" : "Copy Link"}</button>
          </div>
        </div>
        <div style={{ ...card({ padding:"18px 20px" }) }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#4a4a6a", letterSpacing:"1px", textTransform:"uppercase", marginBottom:12 }}>Follow Someone</div>
          <div style={{ fontSize:13, color:"#6a6a8a", marginBottom:12 }}>Enter a code to see their shared shows.</div>
          <div style={{ display:"flex", gap:10 }}>
            <input value={shareCode} onChange={e => setShareCode(e.target.value)} onKeyDown={e => e.key==="Enter" && joinByCode()} placeholder="Enter 6-character code" style={{ flex:1, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:8, padding:"9px 12px", fontSize:14, color:"#e0e0f0", letterSpacing:"2px" }}/>
            <button onClick={joinByCode} disabled={joining || !shareCode.trim()} style={{ background:joining||!shareCode.trim()?"#181830":"#5050d0", color:"#fff", border:"none", borderRadius:8, padding:"9px 16px", fontSize:13, fontWeight:600 }}>{joining ? <LoadingDots/> : "Follow"}</button>
          </div>
          {joinError && <div style={{ marginTop:8, fontSize:12, color:"#ff8888" }}>{joinError}</div>}
        </div>
        {following.length > 0 && (
          <div style={{ ...card({ padding:"18px 20px" }) }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#4a4a6a", letterSpacing:"1px", textTransform:"uppercase", marginBottom:12 }}>Following ({following.length})</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {following.map(f => (
                <div key={f.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:32, height:32, borderRadius:"50%", background:"rgba(128,128,255,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:"#8080ff" }}>{f.display_name?.[0]?.toUpperCase() || "?"}</div>
                    <span style={{ fontSize:14, color:"#c0c0e0" }}>{f.display_name}</span>
                  </div>
                  <button onClick={() => unfollow(f.id)} style={{ background:"transparent", border:"1px solid rgba(255,80,80,0.2)", color:"#ff7070", borderRadius:6, padding:"4px 10px", fontSize:11 }}>Unfollow</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function TVTracker() {
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [profile, setProfile] = useState(null);
  const [shows, setShows] = useState([]);
  const [followedShows, setFollowedShows] = useState([]);
  const [loadingShows, setLoadingShows] = useState(false);
  const [colorIndex, setColorIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("calendar");
  const [selectedShow, setSelectedShow] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState(null); // null = not searched yet
  const [searchError, setSearchError] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [expandedSeasons, setExpandedSeasons] = useState({});
  const [showFollowed, setShowFollowed] = useState(true);
  const [watchingTogether, setWatchingTogether] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setAuthChecked(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
        setSession(session);
      } else {
        setSession(session);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || passwordRecovery) return;
    loadProfile();
    loadShows();
  }, [session, passwordRecovery]);

  async function loadProfile() {
    const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
    setProfile(data);
  }

  async function loadShows() {
    setLoadingShows(true);
    try {
      const { data: showRows } = await supabase.from("shows").select("*").eq("user_id", session.user.id).order("created_at", { ascending:true });
      const { data: watchedRows } = await supabase.from("watched_episodes").select("*").eq("user_id", session.user.id);
      const watchedByShow = {};
      for (const row of (watchedRows || [])) {
        if (!watchedByShow[row.show_id]) watchedByShow[row.show_id] = {};
        watchedByShow[row.show_id][epKey(row.season_num, row.ep_num)] = true;
      }
      const myShows = (showRows || []).map(row => ({
        id:row.id, tvdb_id:row.tvdb_id, title:row.title, platform:row.platform,
        airDay:row.air_day, time:row.time, genre:row.genre, color:row.color,
        seasons:row.seasons, poster:row.poster, is_shared:row.is_shared,
        watched:watchedByShow[row.id] || {}, isOwn:true,
      }));
      setShows(myShows);
      setColorIndex(myShows.length % SHOW_COLORS.length);

      const { data: follows } = await supabase.from("show_followers").select("following_id").eq("follower_id", session.user.id);
      if (follows?.length) {
        const followedIds = follows.map(f => f.following_id);
        const { data: theirShows } = await supabase.from("shows").select("*").in("user_id", followedIds).eq("is_shared", true);
        const { data: theirProfiles } = await supabase.from("profiles").select("*").in("id", followedIds);
        const profileMap = {};
        (theirProfiles || []).forEach(p => { profileMap[p.id] = p; });
        const theirShowIds = (theirShows || []).map(s => s.id);
        let myWatchedOnTheirs = {};
        if (theirShowIds.length) {
          const { data: wo } = await supabase.from("watched_episodes").select("*").eq("user_id", session.user.id).in("show_id", theirShowIds);
          for (const row of (wo || [])) {
            if (!myWatchedOnTheirs[row.show_id]) myWatchedOnTheirs[row.show_id] = {};
            myWatchedOnTheirs[row.show_id][epKey(row.season_num, row.ep_num)] = true;
          }
        }
        setFollowedShows((theirShows || []).map(row => ({
          id:row.id, tvdb_id:row.tvdb_id, title:row.title, platform:row.platform,
          airDay:row.air_day, time:row.time, genre:row.genre, color:row.color,
          seasons:row.seasons, poster:row.poster, is_shared:true,
          watched:myWatchedOnTheirs[row.id] || {}, isOwn:false,
          sharedBy:profileMap[row.user_id]?.display_name || "Unknown",
          sharedByUserId:row.user_id,
        })));
      } else {
        setFollowedShows([]);
      }
    } catch (e) { console.error("loadShows error:", e); }
    setLoadingShows(false);
  }

  useEffect(() => {
    if (!selectedShow) { setWatchingTogether([]); return; }
    loadWatchingTogether(selectedShow);
  }, [selectedShow?.id]);

  async function loadWatchingTogether(show) {
    const { data: allMatchingShows } = await supabase.from("shows").select("id, user_id").eq("tvdb_id", show.tvdb_id);
    if (!allMatchingShows?.length) { setWatchingTogether([]); return; }

    const { data: myFollows } = await supabase.from("show_followers").select("follower_id, following_id")
      .or(`follower_id.eq.${session.user.id},following_id.eq.${session.user.id}`);
    const connectedIds = new Set();
    (myFollows || []).forEach(f => {
      if (f.follower_id === session.user.id) connectedIds.add(f.following_id);
      if (f.following_id === session.user.id) connectedIds.add(f.follower_id);
    });

    const allConnectedIds = [...connectedIds];
    if (!allConnectedIds.length) { setWatchingTogether([]); return; }

    const { data: profiles } = await supabase.from("profiles").select("*").in("id", allConnectedIds);
    const profileMap = {};
    (profiles || []).forEach(p => { profileMap[p.id] = p; });

    const allTvdbShowIds = allMatchingShows.map(s => s.id);
    const { data: theirWatched } = await supabase.from("watched_episodes").select("*")
      .in("user_id", allConnectedIds)
      .in("show_id", allTvdbShowIds);

    const watchedByUser = {};
    for (const row of (theirWatched || [])) {
      if (!watchedByUser[row.user_id]) watchedByUser[row.user_id] = {};
      watchedByUser[row.user_id][epKey(row.season_num, row.ep_num)] = true;
    }

    setWatchingTogether(allConnectedIds.map(userId => ({
      userId,
      displayName: profileMap[userId]?.display_name || "Unknown",
      watched: watchedByUser[userId] || {},
    })));
  }

  async function toggleEpisode(showId, seasonNum, epNum) {
    const allShows = [...shows, ...followedShows];
    const show = allShows.find(s => s.id === showId);
    if (!show) return;
    const key = epKey(seasonNum, epNum);
    const isWatched = !!show.watched?.[key];
    const updater = prev => prev.map(s => s.id !== showId ? s : { ...s, watched: { ...s.watched, [key]: !isWatched } });
    setShows(updater); setFollowedShows(updater);
    setSelectedShow(prev => prev?.id === showId ? { ...prev, watched: { ...prev.watched, [key]: !isWatched } } : prev);
    if (isWatched) {
      await supabase.from("watched_episodes").delete().eq("user_id", session.user.id).eq("show_id", showId).eq("season_num", seasonNum).eq("ep_num", epNum);
    } else {
      await supabase.from("watched_episodes").upsert({ user_id:session.user.id, show_id:showId, season_num:seasonNum, ep_num:epNum });
    }
  }

  async function markSeasonWatched(showId, seasonNum, allWatched) {
    const allShows = [...shows, ...followedShows];
    const show = allShows.find(s => s.id === showId);
    if (!show) return;
    const season = show.seasons.find(se => se.number === seasonNum);
    if (!season) return;
    const updates = {};
    season.episodes.forEach(ep => { updates[epKey(seasonNum, ep.n)] = !allWatched; });
    const updater = prev => prev.map(s => s.id !== showId ? s : { ...s, watched: { ...s.watched, ...updates } });
    setShows(updater); setFollowedShows(updater);
    setSelectedShow(prev => prev?.id === showId ? { ...prev, watched: { ...prev.watched, ...updates } } : prev);
    if (allWatched) {
      await supabase.from("watched_episodes").delete().eq("user_id", session.user.id).eq("show_id", showId).eq("season_num", seasonNum);
    } else {
      await supabase.from("watched_episodes").upsert(season.episodes.map(ep => ({ user_id:session.user.id, show_id:showId, season_num:seasonNum, ep_num:ep.n })));
    }
  }

  async function toggleShared(showId) {
    const show = shows.find(s => s.id === showId);
    if (!show) return;
    const newVal = !show.is_shared;
    setShows(prev => prev.map(s => s.id === showId ? { ...s, is_shared:newVal } : s));
    setSelectedShow(prev => prev?.id === showId ? { ...prev, is_shared:newVal } : prev);
    await supabase.from("shows").update({ is_shared:newVal }).eq("id", showId);
  }

  async function doSearch() {
    if (!search.trim() || searching) return;
    setSearching(true); setSearchError(""); setSearchResults(null); setSelectedCandidate(null);
    try {
      const results = await searchShows(search.trim());
      setSearchResults(results);
    } catch (e) {
      setSearchError(e.message);
    }
    setSearching(false);
  }

  async function confirmAdd(candidate, isShared) {
    if (fetching) return;
    setFetching(true);
    try {
      const data = await fetchShowById(candidate.tvdb_id);
      const color = SHOW_COLORS[colorIndex % SHOW_COLORS.length];
      const { data: inserted, error } = await supabase.from("shows").insert({
        user_id:session.user.id, tvdb_id:data.tvdb_id, title:data.title, platform:data.platform,
        air_day:data.airDay, time:data.time, genre:data.genre, color, seasons:data.seasons,
        poster:data.poster || null, is_shared:isShared,
      }).select().single();
      if (error) throw error;
      setShows(prev => [...prev, {
        id:inserted.id, tvdb_id:inserted.tvdb_id, title:inserted.title, platform:inserted.platform,
        airDay:inserted.air_day, time:inserted.time, genre:inserted.genre, color:inserted.color,
        seasons:inserted.seasons, poster:inserted.poster, is_shared:inserted.is_shared, watched:{}, isOwn:true,
      }]);
      setColorIndex(c => (c+1) % SHOW_COLORS.length);
      setSearch(""); setSearchResults(null); setSelectedCandidate(null); setActiveTab("shows");
    } catch (e) {
      setSearchError(`Could not load show: ${e.message}`);
    }
    setFetching(false);
  }

  async function removeShow(id) {
    setShows(prev => prev.filter(s => s.id !== id));
    if (selectedShow?.id === id) setSelectedShow(null);
    await supabase.from("shows").delete().eq("id", id);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setShows([]); setFollowedShows([]); setSelectedShow(null); setActiveTab("calendar");
  }

  const allVisibleShows = showFollowed ? [...shows, ...followedShows] : shows;
  function showsForDay(day) { return allVisibleShows.filter(s => s.airDay === day); }
  function upNextShows() {
    return allVisibleShows.map(s => ({ show:s, next:getNextEpisode(s) })).filter(x => x.next !== null)
      .sort((a,b) => { const ai=DAYS.indexOf(a.show.airDay), bi=DAYS.indexOf(b.show.airDay); return (ai===-1?99:ai)-(bi===-1?99:bi); });
  }
  function toggleSeason(showId, num) {
    const key = `${showId}-${num}`;
    setExpandedSeasons(prev => ({ ...prev, [key]: !prev[key] }));
  }
  const card = (extra = {}) => ({ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, ...extra });
  const todayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][new Date().getDay()];

  if (!authChecked) return <div style={{ minHeight:"100vh", background:"#0c0c14", display:"flex", alignItems:"center", justifyContent:"center" }}><LoadingDots/></div>;
  if (passwordRecovery && session) return <SetNewPasswordScreen onDone={() => { setPasswordRecovery(false); }}/>;
  if (!session) return <AuthScreen onAuth={setSession}/>;

  return (
    <div style={{ minHeight:"100vh", background:"#0c0c14", color:"#e0e0f0", fontFamily:"'DM Sans','Segoe UI',sans-serif", paddingBottom:60 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Serif+Display:ital@0;1&display=swap');
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes dot-pulse{0%,100%{opacity:.3;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:#1a1a28}::-webkit-scrollbar-thumb{background:#3a3a58;border-radius:2px}
        input::placeholder{color:#3a3a5a}input:focus{outline:none;border-color:#6060c0!important}
        .tab:hover{background:rgba(255,255,255,0.04)!important}
        .show-row:hover{background:rgba(255,255,255,0.055)!important;cursor:pointer}
        .ep-row:hover{background:rgba(255,255,255,0.04)!important}
        .chip:hover{opacity:.8;transform:translateY(-1px)}
        .remove-btn{opacity:0;transition:opacity .15s}
        .show-row:hover .remove-btn{opacity:1}
        .season-hdr:hover{background:rgba(255,255,255,0.04)!important}
        .candidate:hover{border-color:rgba(128,128,255,0.4)!important;background:rgba(255,255,255,0.05)!important}
        button{cursor:pointer;font-family:inherit}
      `}</style>

      {/* Header */}
      <div style={{ background:"linear-gradient(180deg,#12122a,#0c0c14)", borderBottom:"1px solid rgba(255,255,255,0.06)", padding:"22px 32px 0" }}>
        <div style={{ maxWidth:1100, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:2 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:12 }}>
              <h1 style={{ fontFamily:"'DM Serif Display',serif", fontSize:28, fontWeight:400, color:"#fff", letterSpacing:"-0.5px" }}>TV Show Tracker</h1>
              <span style={{ color:"#3a3a5a", fontSize:12 }}>{shows.length} show{shows.length!==1?"s":""} tracked</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontSize:12, color:"#3a3a5a" }}>{profile?.display_name || session.user.email}</span>
              <button onClick={() => { setShowSettings(true); setSelectedShow(null); setActiveTab(null); }}
                style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", color:"#8080c0", borderRadius:7, padding:"5px 12px", fontSize:12 }}>Settings</button>
              <button onClick={signOut} style={{ background:"transparent", border:"1px solid rgba(255,255,255,0.08)", color:"#4a4a6a", borderRadius:7, padding:"5px 12px", fontSize:12 }}>Sign Out</button>
            </div>
          </div>
          <div style={{ display:"flex", marginTop:16 }}>
            {[["calendar","Calendar"],["shows","My Shows"],["add","Add Show"]].map(([id,label]) => (
              <button key={id} className="tab" onClick={() => { setActiveTab(id); setSelectedShow(null); setShowSettings(false); }}
                style={{ background:activeTab===id&&!showSettings?"rgba(255,255,255,0.07)":"transparent", color:activeTab===id&&!showSettings?"#fff":"#4a4a6a", border:"none", borderBottom:activeTab===id&&!showSettings?"2px solid #7070f0":"2px solid transparent", padding:"9px 20px", fontSize:13, fontWeight:500, transition:"all .15s" }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:1100, margin:"0 auto", padding:"26px 32px 0" }}>
        {loadingShows && <div style={{ display:"flex", justifyContent:"center", padding:"60px 0" }}><LoadingDots/></div>}
        {!loadingShows && (
          <>
            {showSettings && <SettingsPanel session={session} profile={profile} onProfileUpdate={setProfile} onClose={() => { setShowSettings(false); setActiveTab("calendar"); }}/>}

            {/* SHOW DETAIL */}
            {!showSettings && selectedShow && (
              <div style={{ animation:"fadeIn .2s ease" }}>
                <button onClick={() => setSelectedShow(null)} style={{ background:"transparent", border:"none", color:"#4a4a6a", fontSize:13, marginBottom:22, display:"flex", alignItems:"center", gap:6, padding:0 }}>&larr; Back</button>
                <div style={{ display:"flex", gap:20, marginBottom:22, flexWrap:"wrap" }}>
                  {selectedShow.poster && (
                    <img src={selectedShow.poster} alt={selectedShow.title} style={{ width:90, height:130, objectFit:"cover", borderRadius:10, flexShrink:0, border:"1px solid rgba(255,255,255,0.08)" }} onError={e => { e.target.style.display="none"; }}/>
                  )}
                  <div style={{ flex:1, minWidth:200 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:4 }}>
                      <h2 style={{ fontFamily:"'DM Serif Display',serif", fontSize:22, fontWeight:400, color:"#fff" }}>{selectedShow.title}</h2>
                      {!selectedShow.isOwn && <span style={{ fontSize:11, color:"#8080ff", background:"rgba(128,128,255,0.12)", border:"1px solid rgba(128,128,255,0.25)", borderRadius:5, padding:"2px 8px" }}>Shared by {selectedShow.sharedBy}</span>}
                      {selectedShow.isOwn && (
                        <button onClick={() => toggleShared(selectedShow.id)} style={{ fontSize:11, fontWeight:600, borderRadius:5, padding:"2px 10px", background:selectedShow.is_shared?"rgba(128,128,255,0.12)":"rgba(255,255,255,0.05)", border:selectedShow.is_shared?"1px solid rgba(128,128,255,0.3)":"1px solid rgba(255,255,255,0.1)", color:selectedShow.is_shared?"#8080ff":"#5a5a7a" }}>
                          {selectedShow.is_shared ? "Shared" : "Private"}
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize:12, color:"#4a4a6a", marginBottom:10 }}>{selectedShow.genre} · {selectedShow.platform} · {selectedShow.airDay}s {selectedShow.time}</div>
                    {(() => {
                      const total = getTotalEpisodes(selectedShow);
                      const watched = getWatchedCount(selectedShow);
                      const next = getNextEpisode(selectedShow);
                      return <>
                        <div style={{ fontSize:13, fontWeight:600, color:selectedShow.color }}>{watched} / {total} episodes watched</div>
                        <div style={{ width:200,height:4,background:"rgba(255,255,255,0.07)",borderRadius:2,marginTop:7,overflow:"hidden" }}>
                          <div style={{ height:"100%",borderRadius:2,background:selectedShow.color,width:total>0?`${(watched/total)*100}%`:"0%",transition:"width .4s" }}/>
                        </div>
                        {next ? <div style={{ fontSize:11,color:"#4a4a6a",marginTop:5 }}>Up next: S{next.season}E{next.episode} &ndash; {next.title}</div>
                              : <div style={{ fontSize:11,color:"#60c060",marginTop:5 }}>All caught up!</div>}
                      </>;
                    })()}
                  </div>
                </div>

                {watchingTogether.length > 0 && (
                  <div style={{ ...card({ padding:"14px 18px", marginBottom:16, borderLeft:"3px solid #8080ff" }) }}>
                    <div style={{ fontSize:11, fontWeight:700, color:"#6060c0", letterSpacing:"1px", textTransform:"uppercase", marginBottom:12 }}>Also Watching ({watchingTogether.length})</div>
                    <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
                      {watchingTogether.map(u => {
                        const total = getTotalEpisodes(selectedShow);
                        const watched = Object.values(u.watched).filter(Boolean).length;
                        return (
                          <div key={u.userId} style={{ display:"flex", alignItems:"center", gap:10, minWidth:160 }}>
                            <div style={{ width:30, height:30, borderRadius:"50%", background:"rgba(128,128,255,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"#8080ff", flexShrink:0 }}>{u.displayName?.[0]?.toUpperCase()}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:13, color:"#c0c0e0", marginBottom:4 }}>{u.displayName}</div>
                              <div style={{ height:3, background:"rgba(255,255,255,0.06)", borderRadius:2, overflow:"hidden" }}>
                                <div style={{ height:"100%", borderRadius:2, background:"#8080ff", width:total>0?`${(watched/total)*100}%`:"0%" }}/>
                              </div>
                              <div style={{ fontSize:11, color:"#4a4a6a", marginTop:3 }}>{watched}/{total}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {(selectedShow.seasons||[]).map(season => {
                    const allWatched = season.episodes.every(ep => selectedShow.watched?.[epKey(season.number,ep.n)]);
                    const watchedCount = season.episodes.filter(ep => selectedShow.watched?.[epKey(season.number,ep.n)]).length;
                    const expanded = !!expandedSeasons[`${selectedShow.id}-${season.number}`];
                    return (
                      <div key={season.number} style={{ ...card(), overflow:"hidden" }}>
                        <div className="season-hdr" onClick={() => toggleSeason(selectedShow.id, season.number)} style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 16px",cursor:"pointer",userSelect:"none" }}>
                          <span style={{ fontSize:11,color:"#4a4a6a",transition:"transform .2s",display:"inline-block",transform:expanded?"rotate(90deg)":"rotate(0deg)" }}>&#9654;</span>
                          <span style={{ fontWeight:600,fontSize:14,color:"#ccc",flex:1 }}>Season {season.number}</span>
                          <span style={{ fontSize:12,color:"#4a4a6a" }}>{watchedCount}/{season.episodes.length} episodes</span>
                          <button onClick={e => { e.stopPropagation(); markSeasonWatched(selectedShow.id,season.number,allWatched); }}
                            style={{ background:allWatched?"rgba(90,200,90,0.14)":"rgba(255,255,255,0.05)", border:allWatched?"1px solid rgba(90,200,90,0.3)":"1px solid rgba(255,255,255,0.1)", color:allWatched?"#70d070":"#7a7a9a", borderRadius:6,padding:"4px 12px",fontSize:11,fontWeight:600 }}>
                            {allWatched ? "All Watched" : "Mark All Watched"}
                          </button>
                        </div>
                        {expanded && (
                          <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)" }}>
                            {season.episodes.map(ep => {
                              const key = epKey(season.number,ep.n);
                              const watched = !!selectedShow.watched?.[key];
                              const nx = getNextEpisode(selectedShow);
                              const isNext = nx && nx.season===season.number && nx.episode===ep.n;
                              return (
                                <div key={ep.n} className="ep-row" onClick={() => toggleEpisode(selectedShow.id,season.number,ep.n)}
                                  style={{ display:"flex",alignItems:"center",gap:12,padding:"9px 16px 9px 42px",borderBottom:"1px solid rgba(255,255,255,0.025)",cursor:"pointer",background:isNext?`${selectedShow.color}10`:"transparent" }}>
                                  <div style={{ width:17,height:17,borderRadius:4,flexShrink:0,border:watched?"none":"2px solid rgba(255,255,255,0.14)",background:watched?selectedShow.color:"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#000",fontWeight:700,transition:"all .15s" }}>{watched?"✓":""}</div>
                                  <span style={{ fontSize:11,color:"#3a3a5a",minWidth:30,fontWeight:500 }}>E{ep.n}</span>
                                  <span style={{ fontSize:13,flex:1,color:watched?"#3a3a5a":"#c8c8e0",textDecoration:watched?"line-through":"none",textDecorationColor:"#2a2a4a" }}>{ep.title}</span>
                                  {isNext && <span style={{ fontSize:10,fontWeight:700,letterSpacing:"0.8px",color:selectedShow.color,background:`${selectedShow.color}20`,borderRadius:4,padding:"2px 7px",flexShrink:0 }}>UP NEXT</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* CALENDAR */}
            {!showSettings && !selectedShow && activeTab==="calendar" && (
              <div style={{ animation:"fadeIn .2s ease" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                  <h3 style={{ fontSize:11,fontWeight:700,color:"#4a4a6a",letterSpacing:"1.2px",textTransform:"uppercase" }}>Up Next</h3>
                  {followedShows.length > 0 && (
                    <button onClick={() => setShowFollowed(v => !v)} style={{ fontSize:11, background:showFollowed?"rgba(128,128,255,0.12)":"rgba(255,255,255,0.04)", border:showFollowed?"1px solid rgba(128,128,255,0.25)":"1px solid rgba(255,255,255,0.08)", color:showFollowed?"#8080ff":"#4a4a6a", borderRadius:6, padding:"4px 12px", fontWeight:600 }}>
                      {showFollowed ? "Showing Shared" : "Hiding Shared"}
                    </button>
                  )}
                </div>
                <div style={{ display:"flex",gap:10,overflowX:"auto",paddingBottom:10,marginBottom:28 }}>
                  {upNextShows().length===0 && <p style={{ color:"#2a2a4a",fontSize:13 }}>All caught up! Add more shows to get started.</p>}
                  {upNextShows().map(({ show, next }) => {
                    const total = getTotalEpisodes(show);
                    const watched = getWatchedCount(show);
                    return (
                      <div key={show.id} onClick={() => setSelectedShow(show)} style={{ ...card({ minWidth:200,flexShrink:0,padding:"13px 16px",borderLeft:`3px solid ${show.color}`,cursor:"pointer",transition:"background .15s" }) }}>
                        {!show.isOwn && <div style={{ fontSize:10, color:"#6060c0", marginBottom:4, fontWeight:600 }}>Shared by {show.sharedBy}</div>}
                        <div style={{ fontSize:11,color:show.color,fontWeight:700,marginBottom:4 }}>{show.airDay} · {show.time}</div>
                        <div style={{ fontSize:14,fontWeight:600,color:"#fff",marginBottom:2 }}>{show.title}</div>
                        <div style={{ fontSize:12,color:"#4a4a6a" }}>S{next.season}E{next.episode} &ndash; {next.title}</div>
                        <div style={{ marginTop:9,height:3,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden" }}>
                          <div style={{ height:"100%",borderRadius:2,background:show.color,width:total>0?`${(watched/total)*100}%`:"0%" }}/>
                        </div>
                        <div style={{ fontSize:11,color:"#3a3a5a",marginTop:4 }}>{watched}/{total} watched</div>
                      </div>
                    );
                  })}
                </div>
                <h3 style={{ fontSize:11,fontWeight:700,color:"#4a4a6a",letterSpacing:"1.2px",textTransform:"uppercase",marginBottom:12 }}>This Week</h3>
                <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:"rgba(255,255,255,0.02)",borderRadius:12,border:"1px solid rgba(255,255,255,0.05)",overflow:"hidden" }}>
                  {DAYS.map((day,i) => {
                    const isToday = day===todayName;
                    const dayShows = showsForDay(day);
                    return (
                      <div key={day} style={{ padding:"13px 9px",minHeight:140,borderRight:i<6?"1px solid rgba(255,255,255,0.04)":"none",background:isToday?"rgba(112,112,240,0.06)":"transparent" }}>
                        <div style={{ fontSize:10,fontWeight:700,letterSpacing:"0.9px",textTransform:"uppercase",color:isToday?"#8080ff":"#2e2e4a",marginBottom:10,display:"flex",alignItems:"center",gap:5 }}>
                          {DAY_SHORT[i]}{isToday && <span style={{ width:5,height:5,borderRadius:"50%",background:"#8080ff",display:"inline-block" }}/>}
                        </div>
                        <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
                          {dayShows.length===0 && <div style={{ fontSize:10,color:"#1c1c2e" }}>&mdash;</div>}
                          {dayShows.map(show => (
                            <div key={show.id} className="chip" onClick={() => setSelectedShow(show)} title={show.title}
                              style={{ background:`${show.color}1c`,border:`1px solid ${show.color}44`,borderRadius:5,padding:"4px 7px",fontSize:11,color:show.color,fontWeight:600,cursor:"pointer",transition:"all .15s",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                              {show.title}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p style={{ fontSize:11,color:"#202030",marginTop:8,textAlign:"center" }}>Click any show to track episodes</p>
              </div>
            )}

            {/* MY SHOWS */}
            {!showSettings && !selectedShow && activeTab==="shows" && (
              <div style={{ animation:"fadeIn .2s ease" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                  <h3 style={{ fontSize:11,fontWeight:700,color:"#4a4a6a",letterSpacing:"1.2px",textTransform:"uppercase" }}>My Shows ({shows.length}{followedShows.length > 0 ? ` + ${followedShows.length} shared` : ""})</h3>
                  {followedShows.length > 0 && (
                    <button onClick={() => setShowFollowed(v => !v)} style={{ fontSize:11, background:showFollowed?"rgba(128,128,255,0.12)":"rgba(255,255,255,0.04)", border:showFollowed?"1px solid rgba(128,128,255,0.25)":"1px solid rgba(255,255,255,0.08)", color:showFollowed?"#8080ff":"#4a4a6a", borderRadius:6, padding:"4px 12px", fontWeight:600 }}>
                      {showFollowed ? "Showing Shared" : "Hiding Shared"}
                    </button>
                  )}
                </div>
                {allVisibleShows.length===0 && <div style={{ textAlign:"center",padding:"52px 0",color:"#2a2a4a",fontSize:14 }}>No shows yet &mdash; go to <strong style={{color:"#6060c0"}}>Add Show</strong></div>}
                <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                  {allVisibleShows.map(show => {
                    const total = getTotalEpisodes(show);
                    const watched = getWatchedCount(show);
                    const next = getNextEpisode(show);
                    return (
                      <div key={show.id} className="show-row" onClick={() => setSelectedShow(show)}
                        style={{ ...card({ borderLeft:`3px solid ${show.color}`,padding:"13px 18px",display:"flex",alignItems:"center",gap:14,transition:"background .15s",position:"relative" }) }}>
                        {show.poster ? (
                          <img src={show.poster} alt={show.title} style={{ width:38, height:54, objectFit:"cover", borderRadius:6, flexShrink:0 }} onError={e => { e.target.style.display="none"; }}/>
                        ) : (
                          <div style={{ width:38,height:38,borderRadius:8,background:`${show.color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:show.color,flexShrink:0 }}>TV</div>
                        )}
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ fontWeight:600,fontSize:15,color:"#e0e0f0" }}>{show.title}</div>
                          <div style={{ fontSize:11,color:"#3a3a5a",marginTop:2 }}>
                            {show.genre} · {show.platform}
                            {!show.isOwn && <span style={{ color:"#6060c0", marginLeft:6 }}>· Shared by {show.sharedBy}</span>}
                          </div>
                          <div style={{ marginTop:7,display:"flex",alignItems:"center",gap:8 }}>
                            <div style={{ flex:1,height:3,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden" }}>
                              <div style={{ height:"100%",borderRadius:2,background:show.color,width:total>0?`${(watched/total)*100}%`:"0%",transition:"width .4s" }}/>
                            </div>
                            <span style={{ fontSize:11,color:"#3a3a5a",flexShrink:0 }}>{watched}/{total}</span>
                          </div>
                        </div>
                        <div style={{ textAlign:"right",flexShrink:0,marginRight:show.isOwn?10:0 }}>
                          <div style={{ fontSize:12,color:show.color,fontWeight:600 }}>{show.airDay}s · {show.time||"—"}</div>
                          {next ? <div style={{ fontSize:11,color:"#4a4a6a",marginTop:3 }}>Next: S{next.season}E{next.episode}</div>
                                : <div style={{ fontSize:11,color:"#60c060",marginTop:3 }}>All watched</div>}
                          {show.isOwn && <div style={{ fontSize:10, marginTop:4, color:show.is_shared?"#6060c0":"#3a3a5a" }}>{show.is_shared?"Shared":"Private"}</div>}
                        </div>
                        {show.isOwn && (
                          <button className="remove-btn" onClick={e => { e.stopPropagation(); removeShow(show.id); }}
                            style={{ background:"rgba(255,60,60,0.12)",border:"1px solid rgba(255,60,60,0.22)",color:"#ff7070",borderRadius:6,padding:"4px 10px",fontSize:11,fontWeight:600,flexShrink:0 }}>
                            Remove
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ADD SHOW */}
            {!showSettings && !selectedShow && activeTab==="add" && (
              <div style={{ animation:"fadeIn .2s ease", maxWidth:600 }}>
                <h3 style={{ fontSize:11,fontWeight:700,color:"#4a4a6a",letterSpacing:"1.2px",textTransform:"uppercase",marginBottom:16 }}>Add a Show</h3>

                {/* Search bar */}
                <div style={{ display:"flex", gap:10, marginBottom:16 }}>
                  <input value={search} onChange={e => { setSearch(e.target.value); setSearchResults(null); setSelectedCandidate(null); }}
                    onKeyDown={e => e.key==="Enter" && doSearch()}
                    placeholder="e.g. The Bear, Shogun, Breaking Bad..."
                    style={{ flex:1, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:10, padding:"12px 16px", fontSize:14, color:"#e0e0f0" }}/>
                  <button onClick={doSearch} disabled={searching || !search.trim()}
                    style={{ background:searching||!search.trim()?"#181830":"#5050d0", color:"#fff", border:"none", borderRadius:10, padding:"12px 20px", fontSize:13, fontWeight:600, whiteSpace:"nowrap" }}>
                    {searching ? <LoadingDots/> : "Search"}
                  </button>
                </div>

                {searchError && <div style={{ background:"rgba(255,80,80,0.09)", border:"1px solid rgba(255,80,80,0.2)", borderRadius:10, padding:"12px 16px", fontSize:13, color:"#ff8888", marginBottom:14 }}>{searchError}</div>}

                {/* Search results */}
                {searchResults && !selectedCandidate && (
                  <div style={{ marginBottom:16 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:"#4a4a6a", letterSpacing:"1px", textTransform:"uppercase", marginBottom:10 }}>
                      {searchResults.length} result{searchResults.length!==1?"s":""} — pick the right one
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                      {searchResults.map(r => (
                        <div key={r.tvdb_id} className="candidate" onClick={() => setSelectedCandidate(r)}
                          style={{ ...card({ padding:"12px 16px", display:"flex", gap:12, alignItems:"center", cursor:"pointer", transition:"all .15s" }) }}>
                          {r.poster ? (
                            <img src={r.poster} alt={r.title} style={{ width:36, height:52, objectFit:"cover", borderRadius:6, flexShrink:0 }} onError={e => { e.target.style.display="none"; }}/>
                          ) : (
                            <div style={{ width:36, height:52, borderRadius:6, background:"rgba(128,128,255,0.1)", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, color:"#4a4a6a" }}>?</div>
                          )}
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:14, fontWeight:600, color:"#e0e0f0", marginBottom:2 }}>{r.title}</div>
                            <div style={{ fontSize:11, color:"#4a4a6a" }}>{r.year} · {r.network}{r.genre ? ` · ${r.genre}` : ""}</div>
                            {r.overview && <div style={{ fontSize:12, color:"#3a3a5a", marginTop:4, lineHeight:1.5 }}>{r.overview}</div>}
                          </div>
                          <div style={{ fontSize:11, color:"#6060c0", flexShrink:0 }}>Select &rarr;</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Confirm selected show */}
                {selectedCandidate && (
                  <div style={{ marginBottom:16 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:"#4a4a6a", letterSpacing:"1px", textTransform:"uppercase", marginBottom:10 }}>Confirm &amp; Add</div>
                    <div style={{ ...card({ padding:"16px", display:"flex", gap:14, alignItems:"center", borderLeft:"3px solid #8080ff", marginBottom:14 }) }}>
                      {selectedCandidate.poster ? (
                        <img src={selectedCandidate.poster} alt={selectedCandidate.title} style={{ width:50, height:72, objectFit:"cover", borderRadius:8, flexShrink:0 }} onError={e => { e.target.style.display="none"; }}/>
                      ) : null}
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:16, fontWeight:700, color:"#fff", marginBottom:4 }}>{selectedCandidate.title}</div>
                        <div style={{ fontSize:12, color:"#4a4a6a" }}>{selectedCandidate.year} · {selectedCandidate.network}</div>
                      </div>
                      <button onClick={() => setSelectedCandidate(null)} style={{ background:"transparent", border:"none", color:"#4a4a6a", fontSize:12 }}>Change</button>
                    </div>
                    <div style={{ display:"flex", gap:10 }}>
                      <button onClick={() => confirmAdd(selectedCandidate, false)} disabled={fetching}
                        style={{ flex:1, background:fetching?"#181830":"#2a2a5a", color:"#8080c0", border:"1px solid rgba(128,128,255,0.2)", borderRadius:10, padding:"12px 20px", fontSize:13, fontWeight:600 }}>
                        {fetching ? <LoadingDots/> : "Add as Private"}
                      </button>
                      <button onClick={() => confirmAdd(selectedCandidate, true)} disabled={fetching}
                        style={{ flex:1, background:fetching?"#181830":"#5050d0", color:"#fff", border:"none", borderRadius:10, padding:"12px 20px", fontSize:13, fontWeight:600 }}>
                        {fetching ? <LoadingDots/> : "Add as Shared"}
                      </button>
                    </div>
                    {fetching && <div style={{ marginTop:12, fontSize:13, color:"#5a5a7a", display:"flex", alignItems:"center", gap:8 }}><LoadingDots/> Fetching episodes from TVDB...</div>}
                  </div>
                )}

                {/* Info box — show only when no results yet */}
                {!searchResults && !searching && (
                  <div style={{ marginTop:8, padding:"16px 20px", ...card({}) }}>
                    <div style={{ fontSize:12, color:"#4a4a6a", lineHeight:1.8 }}>
                      <div style={{ fontWeight:600, color:"#5a5a8a", marginBottom:6 }}>Private vs Shared</div>
                      Private shows are only visible to you. Shared shows appear on the lists of anyone who has followed you with your share code. You can change this any time from the show detail page.
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
