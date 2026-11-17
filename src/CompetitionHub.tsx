import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { ArrowLeft, Award, Eye, Gamepad2, Plug, Plus, RefreshCw, ShieldCheck, Trophy, Users } from 'lucide-react';

type Tournament = {
  id: string; name: string; hostId: string; hostName: string; maxPlayers: number;
  status: 'open' | 'live' | 'completed';
  players: Array<{ id: string; name: string }>;
  matches: Array<{ id: string; round: number; firstPlayerId: string; secondPlayerId: string | null; winnerId: string | null; roomCode?: string }>;
  championId?: string;
};
type Leader = { playerId: string; name: string; wins: number; matches: number };
type SpectatorRoom = { code: string; status: string; players: Array<{ id: string; name: string; color: string }>; state: { turnMessage: string; winner: string | null; currentTurnIndex: number } };

export default function CompetitionHub({ playerId, playerName, onClose }: { playerId: string; playerName: string; onClose: () => void }) {
  const [tab, setTab] = useState<'tournaments' | 'rankings' | 'profile' | 'watch' | 'connect'>('tournaments');
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [summary, setSummary] = useState<{ matchesPlayed: number; wins: number; losses: number; recentMatches: Array<{ roomCode: string; result: string; players: string[] }> } | null>(null);
  const [spectatorCode, setSpectatorCode] = useState('');
  const [spectatorRoom, setSpectatorRoom] = useState<SpectatorRoom | null>(null);
  const [tournamentName, setTournamentName] = useState('');
  const [resultRoomCode, setResultRoomCode] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [manifest, setManifest] = useState<any>(null);

  async function load() {
    try {
      const [t, l, p, m] = await Promise.all([
        api.get('/api/tournaments'), api.get('/api/leaderboard'),
        api.get('/api/players/' + encodeURIComponent(playerId) + '/summary'),
        api.get('/api/integrations/manifest'),
      ]);
      setTournaments(t.data.tournaments || []);
      setLeaders(l.data.leaderboard || []);
      setSummary(p.data);
      setManifest(m.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load competition data.');
    }
  }
  useEffect(() => { void load(); }, [playerId]);
  useEffect(() => {
    if (!spectatorRoom) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await api.get('/api/rooms/' + spectatorRoom.code + '/spectate');
        setSpectatorRoom(response.data.room);
      } catch { setMessage('This match is no longer available to watch.'); }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [spectatorRoom?.code]);

  async function action(task: () => Promise<any>, success: string) {
    setBusy(true); setMessage('');
    try { await task(); await load(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'That action could not be completed.'); }
    finally { setBusy(false); }
  }
  async function createTournament() {
    await action(async () => {
      await api.post('/api/tournaments', { name: tournamentName, maxPlayers, playerId, playerName });
      setTournamentName('');
    }, 'Tournament created. Invite players to join.');
  }
  async function submitTournamentResult(tournamentId: string) {
    await action(async () => {
      await api.post('/api/tournaments/' + tournamentId + '/report-result', { playerId, roomCode: resultRoomCode.toUpperCase() });
      setResultRoomCode('');
    }, 'Tournament result recorded and bracket updated.');
  }
  async function watchMatch() {
    setBusy(true); setMessage('');
    try {
      const response = await api.get('/api/rooms/' + spectatorCode.toUpperCase() + '/spectate');
      setSpectatorRoom(response.data.room);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Match not found.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="competition-hub">
      <div className="competition-head">
        <div><span className="mini-label">LUDO LIVE • COMPETITION CENTRE</span><h2>Play beyond the room.</h2><p>Tournaments, player rankings and live match watching.</p></div>
        <button className="secondary-button" onClick={onClose}><ArrowLeft size={16}/> Back to game</button>
      </div>
      <div className="competition-tabs">
        {([
          ['tournaments', 'Tournaments', Trophy], ['rankings', 'Rankings', Award],
          ['profile', 'My record', Users], ['watch', 'Watch match', Eye], ['connect', 'Connect', Plug],
        ] as const).map(([key, label, Icon]) => <button key={key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}><Icon size={15}/>{label}</button>)}
      </div>
      {message ? <div className="competition-message">{message}</div> : null}
      {tab === 'tournaments' ? <div className="competition-grid">
        <div className="competition-card">
          <span className="mini-label">HOST A COMPETITION</span><h3>Create a tournament</h3>
          <p>Run a free single-elimination bracket with your crew. Players compete in normal Ludo Live rooms and submit completed match codes.</p>
          <input className="text-field" value={tournamentName} maxLength={42} onChange={event => setTournamentName(event.target.value)} placeholder="Tournament name"/>
          <select className="text-field" value={maxPlayers} onChange={event => setMaxPlayers(Number(event.target.value))}><option value={4}>4 players</option><option value={8}>8 players</option><option value={16}>16 players</option></select>
          <button className="primary-button" disabled={busy || tournamentName.trim().length < 3} onClick={() => void createTournament()}><Plus size={16}/> Create tournament</button>
        </div>
        <div className="competition-card">
          <div className="competition-card-title"><div><span className="mini-label">OPEN & LIVE</span><h3>Community tournaments</h3></div><button className="icon-refresh" onClick={() => void load()} aria-label="Refresh"><RefreshCw size={16}/></button></div>
          {tournaments.length ? tournaments.map(t => <div className="tournament-row" key={t.id}>
            <div><b>{t.name}</b><small>{t.players.length}/{t.maxPlayers} players · {t.status}</small></div>
            {t.status === 'open' && !t.players.some(p => p.id === playerId) ? <button className="secondary-button" disabled={busy || t.players.length >= t.maxPlayers} onClick={() => void action(() => api.post('/api/tournaments/' + t.id + '/join', { playerId, playerName }), 'You joined the tournament.')}>Join</button> : t.status === 'open' && t.hostId === playerId ? <button className="secondary-button" disabled={busy || t.players.length < 2} onClick={() => void action(() => api.post('/api/tournaments/' + t.id + '/start', { playerId }), 'Tournament bracket started.')}>Start</button> : <span className="status-tag">{t.status}</span>}
            <div className="tournament-players">{t.players.map(p => p.name).join(' · ')}</div>
            {t.matches.length ? <div className="bracket-mini">{t.matches.map(m => <span key={m.id}>R{m.round}: {t.players.find(p => p.id === m.firstPlayerId)?.name || 'Player'} vs {t.players.find(p => p.id === m.secondPlayerId)?.name || 'BYE'} {m.winnerId ? '✓' : '•'}</span>)}</div> : null}
            {t.status === 'live' && t.matches.some(m => !m.winnerId && [m.firstPlayerId, m.secondPlayerId].includes(playerId)) ? <div className="tournament-result-form"><input className="text-field" value={resultRoomCode} maxLength={6} onChange={event => setResultRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="Completed match room code"/><button className="secondary-button" disabled={busy || resultRoomCode.length !== 6} onClick={() => void submitTournamentResult(t.id)}>Submit result</button></div> : null}
            {t.championId ? <b className="tournament-champion">Champion: {t.players.find(p => p.id === t.championId)?.name || 'Winner'}</b> : null}
          </div>) : <div className="competition-empty">No tournaments yet. Start the first one!</div>}
        </div>
      </div> : null}
      {tab === 'rankings' ? <div className="competition-card"><span className="mini-label">ALL-TIME RESULTS</span><h3>Player leaderboard</h3><p>Rankings are calculated from completed Ludo Live matches currently retained by the game.</p>
        {leaders.length ? leaders.map((item, index) => <div className="leader-row" key={item.playerId}><b className="leader-rank">#{index + 1}</b><span>{item.name}</span><strong>{item.wins} wins</strong><small>{item.matches} matches</small></div>) : <div className="competition-empty">Completed matches will appear here.</div>}
      </div> : null}
      {tab === 'profile' ? <div className="competition-card"><span className="mini-label">PLAYER CARD</span><h3>{playerName}</h3><div className="stat-grid"><div><b>{summary?.matchesPlayed ?? 0}</b><small>Matches</small></div><div><b>{summary?.wins ?? 0}</b><small>Wins</small></div><div><b>{summary?.losses ?? 0}</b><small>Other finishes</small></div></div><h4>Recent matches</h4>{summary?.recentMatches?.length ? summary.recentMatches.map(match => <div className="history-row" key={match.roomCode}><b>{match.result === 'win' ? 'Victory' : 'Match played'}</b><span>Room {match.roomCode}</span><small>{match.players.join(' · ')}</small></div>) : <div className="competition-empty">Your completed matches will show here.</div>}</div> : null}
      {tab === 'watch' ? <div className="competition-card"><span className="mini-label">SPECTATOR MODE</span><h3>Watch a live match</h3><p>Enter a room code to follow the public match state. Spectators cannot move tokens or send messages.</p><div className="spectator-search"><input className="text-field" maxLength={6} value={spectatorCode} onChange={event => setSpectatorCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="ROOM CODE"/><button className="primary-button" disabled={busy || spectatorCode.length !== 6} onClick={() => void watchMatch()}>Watch <Eye size={16}/></button></div>
        {spectatorRoom ? <div className="spectator-view"><div className="competition-card-title"><b>Room {spectatorRoom.code}</b><span className="status-tag">{spectatorRoom.status}</span></div><p>{spectatorRoom.state.turnMessage}</p><div className="spectator-players">{spectatorRoom.players.map(p => <span key={p.id} className={'avatar-pill avatar-' + p.color}>{p.name}</span>)}</div><small>Live public view · refreshes automatically · read-only</small></div> : null}
      </div> : null}
      {tab === 'connect' ? <div className="competition-card"><span className="mini-label">VELTRONIX NEXUS • PLUGIN FOUNDATION</span><h3><Plug size={20}/> Ready for future integrations</h3><p>Ludo Live remains independent. These versioned capabilities prepare approved connections later; no external app is connected today.</p><div className="integration-status"><ShieldCheck size={18}/><span><b>Consent-first API foundation</b><small>Only approved summaries and public tournament data are planned for sharing.</small></span></div><div className="scope-list">{(manifest?.scopes || ['match.summary.read','tournament.summary.read','player.stats.read']).map((scope: string) => <span key={scope}>{scope}</span>)}</div><div className="privacy-note"><b>Never shared by default</b><small>Private messages, camera streams, microphone streams, device contacts and credentials remain outside the integration interface.</small></div><small>API version {manifest?.app?.integrationApiVersion || '1'} · Connected apps: 0</small></div> : null}
      <div className="competition-foot"><span><Gamepad2 size={14}/> Free-to-enter community play</span><span>Fair play • No wagers</span></div>
    </section>
  );
}
