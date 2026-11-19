import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Dice5, Gem, Palette, ShoppingBag, Sparkles, Ticket, Trophy } from 'lucide-react';
import { api } from './lib/api';
type StoreItem={id:string;name:string;category:string;description:string;price:number;icon:string;rarity:string};
type StoreData={coins:number;owned:string[];items:StoreItem[]};
const icons:Record<string,any>={dice:Dice5,trail:Sparkles,token:Gem,board:Palette,victory:Trophy,profile:Ticket};
export default function Store({playerId,onBack}:{playerId:string;onBack:()=>void}){
 const [data,setData]=useState<StoreData|null>(null),[busy,setBusy]=useState(''),[message,setMessage]=useState('');
 async function load(){try{const r=await api.get('/api/store/catalog');setData(r.data);}catch(e){setMessage(e instanceof Error?e.message:'Store could not be loaded.');}}
 useEffect(()=>{void load();},[playerId]);
 async function buy(item:StoreItem){setBusy(item.id);setMessage('');try{const r=await api.post('/api/store/purchase',{itemId:item.id});setData(r.data);setMessage(item.name+' added to your collection!');}catch(e){setMessage(e instanceof Error?e.message:'Purchase could not be completed.');}finally{setBusy('');}}
 return <section className="store-page"><header className="store-heading"><button className="secondary-button" onClick={onBack}><ArrowLeft size={16}/> Home</button><div><span className="mini-label">LUDO LIVE COLLECTIONS</span><h1>THE <em>STORE</em></h1><p>Make your game yours. Every item is cosmetic—your gameplay stays fair.</p></div><div className="store-wallet"><span>YOUR BALANCE</span><b>◈ {data?.coins ?? '—'}</b><small>Earn coins by playing matches</small></div></header>
 {message?<div className="store-message" role="status">{message}</div>:null}<div className="store-category-row"><span><ShoppingBag size={16}/> FEATURED COLLECTION</span><span>{data?.owned.length ?? 0} ITEMS OWNED</span></div>
 <div className="store-item-grid">{data?.items.map(item=>{const Icon=icons[item.icon]||Gem,owned=data.owned.includes(item.id);return <article className={'store-item-card rarity-'+item.rarity.toLowerCase()} key={item.id}><div className="store-item-art"><span>{item.rarity}</span><Icon size={48}/><i>{item.category}</i></div><div className="store-item-copy"><h3>{item.name}</h3><p>{item.description}</p><div className="store-item-buy"><b>◈ {item.price.toLocaleString()}</b><button className={owned?'owned-button':'primary-button'} disabled={owned||busy!==''||!data||data.coins<item.price} onClick={()=>void buy(item)}>{owned?<><Check size={14}/> Owned</>:busy===item.id?'Buying…':'Get item'}</button></div></div></article>;})}</div>
 {!data?<div className="store-loading">Loading your collection…</div>:null}<p className="store-footnote">Coins are earned through completed matches. No real-money purchases, random loot boxes or competitive advantages.</p></section>;
}
