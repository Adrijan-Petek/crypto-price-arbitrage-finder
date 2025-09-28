import React from 'react';
import sample from '../../sample_reports/report-sample.json';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

export default function Home() {
  const data = (sample.opportunities || []).slice(0,5).map((op) => ({ name: op.pair, spread: op.spread_percent }));
  return (
    <div style={{ padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1>Arbitrage Finder — Top Opportunities</h1>
      <BarChart width={700} height={350} data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="spread" />
      </BarChart>

      <h3>Top pairs</h3>
      <ol>
        {(sample.opportunities || []).slice(0,5).map((o,i) => <li key={i}>{o.pair} — {o.spread_percent}% ({o.best} vs {o.worst})</li>)}
      </ol>

      <p style={{ color:'#666', marginTop:20 }}>Deploy `/web` to Vercel and update to fetch reports from your backend artifacts or an API for live data.</p>
    </div>
  );
}
