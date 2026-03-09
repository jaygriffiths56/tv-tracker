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

function epKey(s, e) { return `${s}-${e}`; }

function getNextEpisode(show) {
  if (!show.seasons) return null;
  for (const season of show.seasons) {
    for (const ep of season.episodes) {
      if (!show.watched?.[epKey(season.number, ep.n)]) {
        return { season: season.number, episode: ep.n, title: ep.title };
      }
    }
  }
  return null;
}

function getTotalEpisodes(show) {
  return show.seasons?.reduce((acc, s) => acc + s.episodes.length, 0) ?? 0;
}

function getWatchedCount(show) {
  return Object.values(show.watched || {}).filter(Boolean).length;
}

function LoadingDots({ color = "#8080ff" }) {
  return (
    <span style={{ display:"inline-flex", gap:4, alignItems:"center" }}>
      {[0,1,2].map(i => (
        <span key={i} style={{
          width:5, height:5, borderRadius:"50%", background:color,
          animation:`dot-pulse 1.2s ease-in-out ${i*0.2}s infinite`,
        }}/>
      ))}
    </span>
  );
}

// ── TVDB v4 API ───────────────────────────────────────────────────────────────

let tvdbTokenCache = null;

async function tvdbLogin() {
  if (tvdbTokenCache) return tvdbTokenCache;
  const res = await fetch("https://api4.thetvdb.com/v4/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: "8bd1a8a0-a7af-42c1-a819-4c8a87a5c09c" }),
  });
  if (!res.ok) throw new Error(`TVDB login failed: ${res.status}`);
  const data = await res.json();
  tvdbTokenCache = data.data.token;
  return tvdbTokenCache;
}

async function fetchShowData(title) {
  const token = await tvdbLogin();
  const headers = { Authorization: `Bearer ${token}` };

  const searchRes = await fetch(
    `https://api4.thetvdb.com/v4/search?query=${encodeURIComponent(title)}&type=series&limit=5`,
    { headers }
  );
  if (!searchRes.ok) throw new Error(`TVDB search failed: ${searchRes.status}`);
  const searchData = await searchRes.json();
  const match = searchData.data?.[0];
  if (!match) throw new Error(`No results found for "${title}"`);
  const seriesId = match.tvdb_id;

  const extRes = await fetch(
    `https://api4.thetvdb.com/v4/series/${seriesId}/extended?meta=translations`,
    { headers }
  );
  if (!extRes.ok) throw new Error(`TVDB series lookup failed: ${extRes.status}`);
  const extData = await extRes.json();
  const series = extData.data;

  let page = 0;
  let allEpisodes = [];
  while (true) {
    const epRes = await fetch(
      `https://api4.thetvdb.com/v4/series/${seriesId}/episodes/default?page=${page}`,
      { headers }
    );
    if (!epRes.ok) break;
    const epData = await epRes.json();
    const eps = epData.data?.episodes ?? [];
    if (eps.length === 0) break;
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
  const seasons = Object.keys(seasonMap)
    .map(Number)
    .sort((a, b) => a - b)
    .map(num => ({
      number: num,
      episodes: seasonMap[num].sort((a, b) => a.n - b.n),
    }));

  const network = series.companies?.find(c => c.companyType?.companyTypeId === 1)?.name
    ?? series.originalNetwork?.name
    ?? match.network
    ?? "Unknown";

  const airDay = series.airsDays
    ? Object.entries(series.airsDays).find(([, v]) => v === true)?.[0] ?? "Unknown"
    : "Unknown";
  const airDayFormatted = airDay.charAt(0).toUpperCase() + airDay.slice(1);

  const genre = series.genres?.[0]?.name ?? match.genres?.[0] ?? "Drama";

  return {
    tvdb_id: String(seriesId),
    title: series.name,
    platform: network,
    airDay: airDayFormatted,
    time: series.airsTime ? `${series.airsTime} ET` : "",
    genre,
    seasons,
  };
}

// ── Auth Screen ───────────────────────────────────────────────────────────────

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth(data.session);
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage("Account created! Check your email to confirm, then log in.");
        setMode("login");
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  return (
    <div style={{ minHeight:"100vh", background:"#0c0c14", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=DM+Serif+Display&display=swap');
        @keyframes dot-pulse{0%,100%{opacity:.3;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}
        *{box-sizing:border-box;margin:0;padding:0}
        input:focus{outline:none;border-color:#6060c0!important}
        button{cursor:pointer;font-family:inherit}
      `}</style>
      <div style={{ width:"100%", maxWidth:400, padding:"0 24px" }}>
        <h1 style={{ fontFamily:"'DM Serif Display',serif", fontSize:32, color:"#fff", textAlign:"center", marginBottom:8 }}>TV Show Tracker</h1>
        <p style={{ color:"#3a3a5a", fontSize:13, textAlign:"center", marginBottom:36 }}>Track your shows across every device</p>

        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:"28px 24px" }}>
          <div style={{ display:"flex", marginBottom:24, background:"rgba(255,255,255,0.04)", borderRadius:8, padding:3 }}>
            {[["login","Log In"],["signup","Sign Up"]].map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setError(""); setMessage(""); }}
                style={{ flex:1, background:mode===m?"rgba(255,255,255,0.08)":"transparent", border:"none", color:mode===m?"#fff":"#4a4a6a", borderRadius:6, padding:"7px 0", fontSize:13, fontWeight:500, transition:"all .15s" }}>
                {label}
              </button>
            ))}
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key==="Enter" && handleSubmit()}
              placeholder="Email"
              style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:9, padding:"11px 14px", fontSize:14, color:"#e0e0f0", transition:"border-color .2s" }}
            />
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key==="Enter" && handleSubmit()}
              placeholder="Password"
              style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:9, padding:"11px 14px", fontSize:14, color:"#e0e0f0", transition:"border-color .2s" }}
            />
          </div>

          {error && (
            <div style={{ marginTop:12, padding:"10px 14px", background:"rgba(255,80,80,0.09)", border:"1px solid rgba(255,80,80,0.2)", borderRadius:8, fontSize:13, color:"#ff8888" }}>
              {error}
            </div>
          )}
          {message && (
            <div style={{ marginTop:12, padding:"10px 14px", background:"rgba(80,200,80,0.09)", border:"1px solid rgba(80,200,80,0.2)", borderRadius:8, fontSize:13, color:"#80d080" }}>
              {message}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading || !email.trim() || !password.trim()}
            style={{ marginTop:18, width:"100%", background:loading||!email.trim()||!password.trim()?"#181830":"#5050d0", color:"#fff", border:"none", borderRadius:9, padding:"12px 0", fontSize:14, fontWeight:600, transition:"background .2s" }}>
            {loading ? <LoadingDots/> : mode==="login" ? "Log In" : "Create Account"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function TVTracker() {
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [shows, setShows] = useState([]);
  const [loadingShows, setLoadingShows] = useState(false);
  const [colorIndex, setColorIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("calendar");
  const [selectedShow, setSelectedShow] = useState(null);
  const [search, setSearch] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchStatus, setFetchStatus] = useState("");
  const [fetchError, setFetchError] = useState("");
  const [expandedSeasons, setExpandedSeasons] = useState({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setShows([]); return; }
    loadShows();
  }, [session]);

  async function loadShows() {
    setLoadingShows(true);
    try {
      const { data: showRows, error: showErr } = await supabase
        .from("shows")
        .select("*")
        .order("created_at", { ascending: true });
      if (showErr) throw showErr;

      const { data: watchedRows, error: watchedErr } = await supabase
        .from("watched_episodes")
        .select("*");
      if (watchedErr) throw watchedErr;

      const watchedByShow = {};
      for (const row of watchedRows) {
        if (!watchedByShow[row.show_id]) watchedByShow[row.show_id] = {};
        watchedByShow[row.show_id][epKey(row.season_num, row.ep_num)] = true;
      }

      const loaded = showRows.map(row => ({
        id: row.id,
        tvdb_id: row.tvdb_id,
        title: row.title,
        platform: row.platform,
        airDay: row.air_day,
        time: row.time,
        genre: row.genre,
        color: row.color,
        seasons: row.seasons,
        watched: watchedByShow[row.id] || {},
      }));

      setShows(loaded);
      setColorIndex(loaded.length % SHOW_COLORS.length);
    } catch (e) {
      console.error("loadShows error:", e);
    }
    setLoadingShows(false);
  }

  async function toggleEpisode(showId, seasonNum, epNum) {
    const show = shows.find(s => s.id === showId);
    if (!show) return;
    const key = epKey(seasonNum, epNum);
    const isWatched = !!show.watched?.[key];

    setShows(prev => prev.map(s => {
      if (s.id !== showId) return s;
      return { ...s, watched: { ...s.watched, [key]: !isWatched } };
    }));
    setSelectedShow(prev => prev?.id === showId
      ? { ...prev, watched: { ...prev.watched, [key]: !isWatched } }
      : prev
    );

    if (isWatched) {
      await supabase.from("watched_episodes").delete()
        .eq("show_id", showId).eq("season_num", seasonNum).eq("ep_num", epNum);
    } else {
      await supabase.from("watched_episodes").upsert({
        user_id: session.user.id, show_id: showId, season_num: seasonNum, ep_num: epNum,
      });
    }
  }

  async function markSeasonWatched(showId, seasonNum, allWatched) {
    const show = shows.find(s => s.id === showId);
    if (!show) return;
    const season = show.seasons.find(se => se.number === seasonNum);
    if (!season) return;

    const updates = {};
    season.episodes.forEach(ep => { updates[epKey(seasonNum, ep.n)] = !allWatched; });

    setShows(prev => prev.map(s => {
      if (s.id !== showId) return s;
      return { ...s, watched: { ...s.watched, ...updates } };
    }));
    setSelectedShow(prev => prev?.id === showId
      ? { ...prev, watched: { ...prev.watched, ...updates } }
      : prev
    );

    if (allWatched) {
      await supabase.from("watched_episodes").delete()
        .eq("show_id", showId).eq("season_num", seasonNum);
    } else {
      const rows = season.episodes.map(ep => ({
        user_id: session.user.id, show_id: showId, season_num: seasonNum, ep_num: ep.n,
      }));
      await supabase.from("watched_episodes").upsert(rows);
    }
  }

  async function addShow() {
    if (!search.trim() || fetching) return;
    setFetching(true);
    setFetchError("");
    setFetchStatus("Looking up show on TVDB...");
    try {
      const data = await fetchShowData(search.trim());
      const color = SHOW_COLORS[colorIndex % SHOW_COLORS.length];

      const { data: inserted, error } = await supabase.from("shows").insert({
        user_id: session.user.id,
        tvdb_id: data.tvdb_id,
        title: data.title,
        platform: data.platform,
        air_day: data.airDay,
        time: data.time,
        genre: data.genre,
        color,
        seasons: data.seasons,
      }).select().single();

      if (error) throw error;

      setShows(prev => [...prev, {
        id: inserted.id,
        tvdb_id: inserted.tvdb_id,
        title: inserted.title,
        platform: inserted.platform,
        airDay: inserted.air_day,
        time: inserted.time,
        genre: inserted.genre,
        color: inserted.color,
        seasons: inserted.seasons,
        watched: {},
      }]);
      setColorIndex(c => (c + 1) % SHOW_COLORS.length);
      setSearch("");
      setFetchStatus("");
      setActiveTab("shows");
    } catch (e) {
      console.error("addShow error:", e);
      setFetchError(`Could not load "${search}" — ${e.message}`);
      setFetchStatus("");
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
    setShows([]);
    setSelectedShow(null);
    setActiveTab("calendar");
  }

  function showsForDay(day) { return shows.filter(s => s.airDay === day); }

  function upNextShows() {
    return shows
      .map(s => ({ show: s, next: getNextEpisode(s) }))
      .filter(x => x.next !== null)
      .sort((a, b) => {
        const ai = DAYS.indexOf(a.show.airDay), bi = DAYS.indexOf(b.show.airDay);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
  }

  function toggleSeason(showId, num) {
    const key = `${showId}-${num}`;
    setExpandedSeasons(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const card = (extra = {}) => ({
    background:"rgba(255,255,255,0.03)",
    border:"1px solid rgba(255,255,255,0.07)",
    borderRadius:10, ...extra,
  });

  const todayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][new Date().getDay()];

  if (!authChecked) return (
    <div style={{ minHeight:"100vh", background:"#0c0c14", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <LoadingDots/>
    </div>
  );

  if (!session) return <AuthScreen onAuth={setSession}/>;

  return (
    <div style={{ minHeight:"100vh", background:"#0c0c14", color:"#e0e0f0",
      fontFamily:"'DM Sans','Segoe UI',sans-serif", paddingBottom:60 }}>
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
        button{cursor:pointer;font-family:inherit}
      `}</style>

      {/* Header */}
      <div style={{ background:"linear-gradient(180deg,#12122a,#0c0c14)", borderBottom:"1px solid rgba(255,255,255,0.06)", padding:"22px 32px 0" }}>
        <div style={{ maxWidth:1100, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:2 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:12 }}>
              <h1 style={{ fontFamily:"'DM Serif Display',serif", fontSize:28, fontWeight:400, color:"#fff", letterSpacing:"-0.5px" }}>TV Show Tracker</h1>
              <span style={{ color:"#3a3a5a", fontSize:12 }}>{shows.length} show{shows.length!==1?"s":""} tracked</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontSize:12, color:"#3a3a5a" }}>{session.user.email}</span>
              <button onClick={signOut}
                style={{ background:"transparent", border:"1px solid rgba(255,255,255,0.08)", color:"#4a4a6a", borderRadius:7, padding:"5px 12px", fontSize:12 }}>
                Sign Out
              </button>
            </div>
          </div>
          <div style={{ display:"flex", marginTop:16 }}>
            {[["calendar","Calendar"],["shows","My Shows"],["add","Add Show"]].map(([id,label]) => (
              <button key={id} className="tab"
                onClick={() => { setActiveTab(id); setSelectedShow(null); }}
                style={{
                  background:activeTab===id?"rgba(255,255,255,0.07)":"transparent",
                  color:activeTab===id?"#fff":"#4a4a6a",
                  border:"none", borderBottom:activeTab===id?"2px solid #7070f0":"2px solid transparent",
                  padding:"9px 20px", fontSize:13, fontWeight:500, transition:"all .15s",
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:1100, margin:"0 auto", padding:"26px 32px 0" }}>

        {loadingShows && (
          <div style={{ display:"flex", justifyContent:"center", padding:"60px 0" }}>
            <LoadingDots/>
          </div>
        )}

        {!loadingShows && (
          <>
            {/* EPISODE DETAIL */}
            {selectedShow && (
              <div style={{ animation:"fadeIn .2s ease" }}>
                <button onClick={() => setSelectedShow(null)}
                  style={{ background:"transparent", border:"none", color:"#4a4a6a", fontSize:13, marginBottom:22, display:"flex", alignItems:"center", gap:6, padding:0 }}>
                  &larr; Back
                </button>
                <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:22, flexWrap:"wrap" }}>
                  <div style={{ width:46,height:46,borderRadius:12,background:`${selectedShow.color}28`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:selectedShow.color,flexShrink:0 }}>TV</div>
                  <div style={{ flex:1, minWidth:200 }}>
                    <h2 style={{ fontFamily:"'DM Serif Display',serif", fontSize:22, fontWeight:400, color:"#fff" }}>{selectedShow.title}</h2>
                    <div style={{ fontSize:12, color:"#4a4a6a", marginTop:3 }}>{selectedShow.genre} · {selectedShow.platform} · {selectedShow.airDay}s {selectedShow.time}</div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    {(() => {
                      const total = getTotalEpisodes(selectedShow);
                      const watched = getWatchedCount(selectedShow);
                      const next = getNextEpisode(selectedShow);
                      return <>
                        <div style={{ fontSize:13, fontWeight:600, color:selectedShow.color }}>{watched} / {total} episodes watched</div>
                        <div style={{ width:160,height:4,background:"rgba(255,255,255,0.07)",borderRadius:2,marginTop:7,overflow:"hidden" }}>
                          <div style={{ height:"100%",borderRadius:2,background:selectedShow.color,width:total>0?`${(watched/total)*100}%`:"0%",transition:"width .4s" }}/>
                        </div>
                        {next
                          ? <div style={{ fontSize:11,color:"#4a4a6a",marginTop:5 }}>Up next: S{next.season}E{next.episode} &ndash; {next.title}</div>
                          : <div style={{ fontSize:11,color:"#60c060",marginTop:5 }}>All caught up!</div>
                        }
                      </>;
                    })()}
                  </div>
                </div>

                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {(selectedShow.seasons||[]).map(season => {
                    const allWatched = season.episodes.every(ep => selectedShow.watched?.[epKey(season.number,ep.n)]);
                    const watchedCount = season.episodes.filter(ep => selectedShow.watched?.[epKey(season.number,ep.n)]).length;
                    const expanded = !!expandedSeasons[`${selectedShow.id}-${season.number}`];
                    return (
                      <div key={season.number} style={{ ...card(), overflow:"hidden" }}>
                        <div className="season-hdr"
                          onClick={() => toggleSeason(selectedShow.id, season.number)}
                          style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 16px",cursor:"pointer",userSelect:"none" }}>
                          <span style={{ fontSize:11,color:"#4a4a6a",transition:"transform .2s",display:"inline-block",transform:expanded?"rotate(90deg)":"rotate(0deg)" }}>&#9654;</span>
                          <span style={{ fontWeight:600,fontSize:14,color:"#ccc",flex:1 }}>Season {season.number}</span>
                          <span style={{ fontSize:12,color:"#4a4a6a" }}>{watchedCount}/{season.episodes.length} episodes</span>
                          <button
                            onClick={e => { e.stopPropagation(); markSeasonWatched(selectedShow.id,season.number,allWatched); }}
                            style={{
                              background:allWatched?"rgba(90,200,90,0.14)":"rgba(255,255,255,0.05)",
                              border:allWatched?"1px solid rgba(90,200,90,0.3)":"1px solid rgba(255,255,255,0.1)",
                              color:allWatched?"#70d070":"#7a7a9a",
                              borderRadius:6,padding:"4px 12px",fontSize:11,fontWeight:600,
                            }}>
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
                                <div key={ep.n} className="ep-row"
                                  onClick={() => toggleEpisode(selectedShow.id,season.number,ep.n)}
                                  style={{
                                    display:"flex",alignItems:"center",gap:12,
                                    padding:"9px 16px 9px 42px",
                                    borderBottom:"1px solid rgba(255,255,255,0.025)",
                                    cursor:"pointer",
                                    background:isNext?`${selectedShow.color}10`:"transparent",
                                  }}>
                                  <div style={{
                                    width:17,height:17,borderRadius:4,flexShrink:0,
                                    border:watched?"none":"2px solid rgba(255,255,255,0.14)",
                                    background:watched?selectedShow.color:"transparent",
                                    display:"flex",alignItems:"center",justifyContent:"center",
                                    fontSize:10,color:"#000",fontWeight:700,transition:"all .15s",
                                  }}>{watched?"✓":""}</div>
                                  <span style={{ fontSize:11,color:"#3a3a5a",minWidth:30,fontWeight:500 }}>E{ep.n}</span>
                                  <span style={{ fontSize:13,flex:1,color:watched?"#3a3a5a":"#c8c8e0",textDecoration:watched?"line-through":"none",textDecorationColor:"#2a2a4a" }}>
                                    {ep.title}
                                  </span>
                                  {isNext && (
                                    <span style={{ fontSize:10,fontWeight:700,letterSpacing:"0.8px",color:selectedShow.color,background:`${selectedShow.color}20`,borderRadius:4,padding:"2px 7px",flexShrink:0 }}>
                                      UP NEXT
                                    </span>
                                  )}
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
            {!selectedShow && activeTab==="calendar" && (
              <div style={{ animation:"fadeIn .2s ease" }}>
                <h3 style={{ fontSize:11,fontWeight:700,color:"#4a4a6a",letterSpacing:"1.2px",textTransform:"uppercase",marginBottom:12 }}>Up Next</h3>
                <div style={{ display:"flex",gap:10,overflowX:"auto",paddingBottom:10,marginBottom:28 }}>
                  {upNextShows().length===0 && <p style={{ color:"#2a2a4a",fontSize:13 }}>All caught up! Add more shows to get started.</p>}
                  {upNextShows().map(({ show, next }) => {
                    const total = getTotalEpisodes(show);
                    const watched = getWatchedCount(show);
                    return (
                      <div key={show.id} onClick={() => setSelectedShow(show)}
                        style={{ ...card({ minWidth:200,flexShrink:0,padding:"13px 16px",borderLeft:`3px solid ${show.color}`,cursor:"pointer",transition:"background .15s" }) }}>
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
                          {DAY_SHORT[i]}
                          {isToday && <span style={{ width:5,height:5,borderRadius:"50%",background:"#8080ff",display:"inline-block" }}/>}
                        </div>
                        <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
                          {dayShows.length===0 && <div style={{ fontSize:10,color:"#1c1c2e" }}>&mdash;</div>}
                          {dayShows.map(show => (
                            <div key={show.id} className="chip"
                              onClick={() => setSelectedShow(show)}
                              title={show.title}
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
            {!selectedShow && activeTab==="shows" && (
              <div style={{ animation:"fadeIn .2s ease" }}>
                <h3 style={{ fontSize:11,fontWeight:700,color:"#4a4a6a",letterSpacing:"1.2px",textTransform:"uppercase",marginBottom:16 }}>
                  My Shows ({shows.length})
                </h3>
                {shows.length===0 && (
                  <div style={{ textAlign:"center",padding:"52px 0",color:"#2a2a4a",fontSize:14 }}>
                    No shows yet &mdash; go to <strong style={{color:"#6060c0"}}>Add Show</strong>
                  </div>
                )}
                <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                  {shows.map(show => {
                    const total = getTotalEpisodes(show);
                    const watched = getWatchedCount(show);
                    const next = getNextEpisode(show);
                    return (
                      <div key={show.id} className="show-row"
                        onClick={() => setSelectedShow(show)}
                        style={{ ...card({ borderLeft:`3px solid ${show.color}`,padding:"13px 18px",display:"flex",alignItems:"center",gap:14,transition:"background .15s",position:"relative" }) }}>
                        <div style={{ width:38,height:38,borderRadius:8,background:`${show.color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:show.color,flexShrink:0 }}>TV</div>
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ fontWeight:600,fontSize:15,color:"#e0e0f0" }}>{show.title}</div>
                          <div style={{ fontSize:11,color:"#3a3a5a",marginTop:2 }}>{show.genre} · {show.platform}</div>
                          <div style={{ marginTop:7,display:"flex",alignItems:"center",gap:8 }}>
                            <div style={{ flex:1,height:3,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden" }}>
                              <div style={{ height:"100%",borderRadius:2,background:show.color,width:total>0?`${(watched/total)*100}%`:"0%",transition:"width .4s" }}/>
                            </div>
                            <span style={{ fontSize:11,color:"#3a3a5a",flexShrink:0 }}>{watched}/{total}</span>
                          </div>
                        </div>
                        <div style={{ textAlign:"right",flexShrink:0,marginRight:10 }}>
                          <div style={{ fontSize:12,color:show.color,fontWeight:600 }}>{show.airDay}s · {show.time||"—"}</div>
                          {next
                            ? <div style={{ fontSize:11,color:"#4a4a6a",marginTop:3 }}>Next: S{next.season}E{next.episode}</div>
                            : <div style={{ fontSize:11,color:"#60c060",marginTop:3 }}>All watched</div>
                          }
                        </div>
                        <button className="remove-btn"
                          onClick={e => { e.stopPropagation(); removeShow(show.id); }}
                          style={{ background:"rgba(255,60,60,0.12)",border:"1px solid rgba(255,60,60,0.22)",color:"#ff7070",borderRadius:6,padding:"4px 10px",fontSize:11,fontWeight:600,flexShrink:0 }}>
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ADD SHOW */}
            {!selectedShow && activeTab==="add" && (
              <div style={{ animation:"fadeIn .2s ease",maxWidth:560 }}>
                <h3 style={{ fontSize:11,fontWeight:700,color:"#4a4a6a",letterSpacing:"1.2px",textTransform:"uppercase",marginBottom:16 }}>Add a Show</h3>
                <div style={{ display:"flex",gap:10,marginBottom:16 }}>
                  <input
                    value={search} onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => e.key==="Enter" && !fetching && addShow()}
                    placeholder="e.g. The Bear, Shogun, Breaking Bad..."
                    style={{ flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:10,padding:"12px 16px",fontSize:14,color:"#e0e0f0",transition:"border-color .2s" }}
                  />
                  <button onClick={addShow} disabled={fetching || !search.trim()}
                    style={{ background:fetching||!search.trim()?"#181830":"#5050d0",color:"#fff",border:"none",borderRadius:10,padding:"12px 20px",fontSize:14,fontWeight:600,minWidth:90,transition:"background .2s" }}>
                    {fetching ? <LoadingDots/> : "Add"}
                  </button>
                </div>

                {fetching && (
                  <div style={{ ...card({ padding:"14px 18px",marginBottom:14,display:"flex",alignItems:"center",gap:12 }) }}>
                    <LoadingDots/>
                    <span style={{ fontSize:13,color:"#5a5a7a" }}>{fetchStatus}</span>
                  </div>
                )}

                {fetchError && !fetching && (
                  <div style={{ background:"rgba(255,80,80,0.09)",border:"1px solid rgba(255,80,80,0.2)",borderRadius:10,padding:"12px 16px",fontSize:13,color:"#ff8888",marginBottom:14,lineHeight:1.6 }}>
                    {fetchError}
                  </div>
                )}

                <div style={{ marginTop:20, padding:"16px 20px", ...card({}) }}>
                  <div style={{ fontSize:12,color:"#4a4a6a",lineHeight:1.8 }}>
                    <div style={{ fontWeight:600,color:"#5a5a8a",marginBottom:6 }}>How it works</div>
                    Type a show name and hit Add. Episode data is pulled from TVDB and usually loads within a few seconds. Your progress syncs automatically across all your devices.
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
