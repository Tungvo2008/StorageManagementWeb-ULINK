import { useState } from 'react';
import CatalogStudio from './CatalogStudio';
import LegacyCatalogPage from './LegacyCatalogPage';
export default function CatalogPage(){const [legacy,setLegacy]=useState(false);return <><div style={{padding:'16px 20px 0'}}><button className="btn" onClick={()=>setLegacy(false)}>Catalog Studio · mẫu Gourmet</button> <button className="btn" onClick={()=>setLegacy(true)}>Mẫu lưới cũ</button></div>{legacy?<LegacyCatalogPage/>:<CatalogStudio/>}</>;}
