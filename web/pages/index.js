import React, { useEffect, useMemo, useState } from 'react';
import sampleReport from '../../sample_reports/report-sample.json';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';

const accent = '#0ED2F7';

export default function Home() {
  const [report, setReport] = useState(null);
  const [notice, setNotice] = useState('');
  const [chainFilter, setChainFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (typeof window === 'undefined') {
          setReport(sampleReport);
          return;
        }
        const res = await fetch('/reports/latest.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('No live report found');
        const data = await res.json();
        if (mounted) setReport(data);
      } catch (err) {
        setReport(sampleReport);
        setNotice('Showing sample data (no live report found).');
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const rows = useMemo(() => {
    if (!report) return [];
    return (report.chains || []).flatMap(chain =>
      (chain.opportunities || []).map(op => ({ ...op, chain: chain.chain }))
    );
  }, [report]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter(r => (chainFilter === 'all' ? true : r.chain === chainFilter))
      .filter(r => (!needle ? true : `${r.pair} ${r.chain}`.toLowerCase().includes(needle)))
      .sort((a, b) => (b.spread_percent || 0) - (a.spread_percent || 0));
  }, [rows, chainFilter, search]);

  const chartData = filtered.slice(0, 8).map(r => ({ name: `${r.pair} (${r.chain})`, spread: Number(r.spread_percent?.toFixed(3) || 0) }));
  const chainOptions = useMemo(() => {
    const set = new Set(rows.map(r => r.chain));
    return Array.from(set);
  }, [rows]);

  const summary = report?.summary || {};

  return (
    <div className="page">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600&display=swap');
        body { margin:0; font-family: 'Space Grotesk', 'Segoe UI', system-ui, -apple-system, sans-serif; background: radial-gradient(circle at 20% 20%, #0f172a, #0b1220 40%, #060a17 100%); color: #f5f7fb; }
      `}</style>

      <div className="shell">
        <header>
          <div>
            <p className="eyebrow">Live Arbitrage Radar</p>
            <h1>Top Crypto DEX Aggregator Spreads</h1>
            <p className="sub">0x ? 1inch ? Paraswap ? CowSwap ? multi-chain scan</p>
            {notice && <div className="notice">{notice}</div>}
          </div>
          <div className="chips">
            <div className="chip">Chains: {summary.total_chains || (report?.chains?.length ?? '?')}</div>
            <div className="chip">Pairs: {summary.total_pairs || '?'}</div>
            <div className="chip">Candidates: {summary.candidates || '?'}</div>
            {report?.timestamp && <div className="chip">{new Date(report.timestamp).toLocaleString()}</div>}
          </div>
        </header>

        <section className="panel">
          <div className="panel-header">
            <h2>Opportunities (sorted by spread)</h2>
            <div className="controls">
              <label>
                Chain
                <select value={chainFilter} onChange={e => setChainFilter(e.target.value)}>
                  <option value="all">All</option>
                  {chainOptions.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <input
                type="search"
                placeholder="Search pair or chain"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="chart-block">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2a44" />
                <XAxis dataKey="name" tick={{ fill: '#c9d1e6', fontSize: 12 }} interval={0} angle={-10} dy={12} />
                <YAxis tick={{ fill: '#c9d1e6', fontSize: 12 }} />
                <Tooltip contentStyle={{ background: '#0d1526', border: '1px solid #1f2a44', color: '#fff' }} />
                <Bar dataKey="spread" fill={accent} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid">
            {filtered.slice(0, 12).map(item => (
              <div className="card" key={`${item.chain}-${item.pair}`}>
                <div className="card-top">
                  <div>
                    <p className="label">{item.chain}</p>
                    <h3>{item.pair}</h3>
                  </div>
                  <div className="pill">{item.spread_percent?.toFixed(3)}%</div>
                </div>
                <p className="muted">Best: {item.best || 'n/a'} ? Worst: {item.worst || 'n/a'}</p>
                <p className="muted">Sell: {item.sellAmount} {item.sellToken} ? {item.buyToken}</p>
                {item.liquidity_flag && <p className="warn">{item.liquidity_flag}</p>}
              </div>
            ))}
          </div>
        </section>
      </div>

      <style jsx>{`
        .page { min-height: 100vh; }
        .shell { max-width: 1200px; margin: 0 auto; padding: 32px 24px 48px; }
        header { display: flex; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
        h1 { margin: 4px 0 8px; font-size: 32px; letter-spacing: -0.02em; }
        h2 { margin: 0; font-size: 20px; }
        h3 { margin: 4px 0; }
        .eyebrow { text-transform: uppercase; letter-spacing: 0.14em; font-size: 12px; color: #8ab5ff; margin: 0; }
        .sub { color: #a8b3c7; margin: 0; }
        .notice { margin-top: 8px; padding: 8px 10px; background: rgba(14,210,247,0.08); border: 1px solid rgba(14,210,247,0.3); border-radius: 8px; color: #9ce3ff; }
        .chips { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .chip { background: #0f192c; border: 1px solid #1f2a44; padding: 8px 12px; border-radius: 10px; color: #d7e0f5; font-size: 13px; }
        .panel { margin-top: 24px; background: linear-gradient(135deg, rgba(15,26,48,0.95), rgba(10,15,30,0.95)); border: 1px solid #1f2a44; border-radius: 16px; padding: 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
        .panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
        .controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #9fb1d5; }
        select, input { background: #0d1526; border: 1px solid #1f2a44; color: #e8edfa; padding: 8px 10px; border-radius: 10px; min-width: 150px; }
        input { min-width: 220px; }
        .chart-block { background: #0d1526; border: 1px solid #1f2a44; border-radius: 14px; padding: 12px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin-top: 14px; }
        .card { background: #0d1526; border: 1px solid #1f2a44; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
        .card-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
        .pill { background: rgba(14,210,247,0.15); color: #7ee9ff; padding: 6px 10px; border-radius: 999px; border: 1px solid rgba(14,210,247,0.35); font-weight: 600; }
        .label { margin: 0; color: #7aa2ff; font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase; }
        .muted { margin: 0; color: #a8b3c7; font-size: 14px; }
        .warn { color: #ffda8b; margin: 0; font-size: 13px; }
        @media (max-width: 768px) {
          h1 { font-size: 26px; }
          .controls { width: 100%; }
          .chart-block { padding: 6px; }
        }
      `}</style>
    </div>
  );
}
