import { useEffect, useState } from 'react';
import { apiJson, assetUrl, downloadFile } from '../api/client';
type Entry={id:number;listing_id:number;reference:string;name:string;sku:string;brand:string;image_url:string|null;published:boolean;enabled:boolean;group_id:string;sort_order:number;unit_size:string;case_pack:string;minimum_order:string;print_description:string};
type Data={groups:{id:string;name:string}[];entries:Entry[];available:{listing_id:number;name:string;sku:string}[]};
const input={width:'100%',padding:8,border:'1px solid #cbd5e1',borderRadius:6,boxSizing:'border-box' as const};
export default function CatalogPanel(){
 const [data,setData]=useState<Data>();const [edit,setEdit]=useState<Entry>();const [query,setQuery]=useState('');const [status,setStatus]=useState('');const [busy,setBusy]=useState(false);const [add,setAdd]=useState('');
 async function refresh(){setData(await apiJson<Data>('/api/v1/showcase/catalog'));}
 useEffect(()=>{void refresh().catch(e=>setStatus(String(e)));},[]);
 async function save(){if(!edit)return;setBusy(true);try{await apiJson(`/api/v1/showcase/catalog/${edit.id}`,{method:'PUT',body:JSON.stringify(edit)});await refresh();setStatus('Đã lưu. Lần xuất tiếp theo sẽ dùng thông tin mới.');}catch(e){setStatus(String(e));}finally{setBusy(false);}}
 async function exportPdf(){setBusy(true);setStatus('Đang xuất từ dữ liệu hiện tại...');try{await downloadFile('/api/v1/showcase/catalog/export.pdf','ULINK-Catalog.pdf');setStatus('Đã xuất PDF.');}catch(e){setStatus(String(e));}finally{setBusy(false);}}
 return <section style={{padding:18,marginBottom:20,border:'1px solid #cbd5e1',borderRadius:12,background:'white'}}>
 <h2>Catalog từ Showcase</h2><p><a className="btn primary" href="/catalog">Mở Catalog Studio · chọn sản phẩm và tùy chỉnh mẫu</a></p><p>Tên và ảnh lấy từ nội dung web ULINK. Điền thông tin đặt hàng bên dưới rồi xuất PDF theo mẫu đã duyệt. Sản phẩm có nhiều quy cách được giữ thành nhiều dòng tham chiếu.</p>
 <button disabled={busy} onClick={()=>void exportPdf()}>Xuất catalog PDF</button> <span role="status">{status}</span>
 {data&&<><p>{data.entries.filter(e=>e.enabled&&e.published).length} dòng đang chọn · {data.available.length} sản phẩm web có thể bổ sung</p>
 <details><summary>Thêm sản phẩm từ web vào catalog</summary><select style={input} value={add} onChange={e=>setAdd(e.target.value)}><option value="">Chọn sản phẩm</option>{data.available.map(p=><option key={p.listing_id} value={p.listing_id}>{p.name}</option>)}</select><button disabled={!add||busy} onClick={async()=>{try{await apiJson('/api/v1/showcase/catalog',{method:'POST',body:JSON.stringify({listing_id:Number(add),group_id:edit?.group_id||data.groups[0].id})});setAdd('');await refresh();}catch(e){setStatus(String(e));}}}>Thêm vào nhóm đang chọn</button></details>
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:20,marginTop:14}}><div><input style={input} placeholder="Tìm tên hoặc mã tham chiếu" value={query} onChange={e=>setQuery(e.target.value)}/><div style={{maxHeight:480,overflow:'auto'}}>{data.entries.filter(e=>(e.name+' '+e.reference).toLowerCase().includes(query.toLowerCase())).map(e=><button key={e.id} onClick={()=>{setEdit({...e});setStatus('');}} style={{display:'block',width:'100%',textAlign:'left',padding:10,background:edit?.id===e.id?'#e2f5e9':'white',border:'1px solid #e2e8f0'}}>{e.enabled?'✓ ':''}{e.name}<small style={{display:'block'}}>{e.reference}{!e.published?' · Đã ẩn trên web':''}</small></button>)}</div></div>
 {edit&&<div style={{display:'grid',gap:10,alignContent:'start'}}><strong>{edit.name}</strong>{edit.image_url&&<img src={assetUrl(edit.image_url)} alt={edit.name} style={{width:90,height:90,objectFit:'contain'}}/>}<small>Tên và ảnh được cập nhật trong Nội dung website.</small>
 <label><input type="checkbox" checked={edit.enabled} onChange={e=>setEdit({...edit,enabled:e.target.checked})}/> Đưa vào catalog</label>
 <label>Nhóm catalog<select style={input} value={edit.group_id} onChange={e=>setEdit({...edit,group_id:e.target.value})}>{data.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
 {(['brand','unit_size','case_pack','minimum_order','print_description'] as const).map((k,i)=><label key={k}>{['Thương hiệu','Quy cách sản phẩm','Quy cách đóng thùng','Số lượng đặt tối thiểu','Mô tả ngắn trong catalog'][i]}<textarea style={input} maxLength={k==='print_description'?600:300} value={edit[k]} onChange={e=>setEdit({...edit,[k]:e.target.value})}/></label>)}
 <label>Thứ tự<input style={input} type="number" min={0} value={edit.sort_order} onChange={e=>setEdit({...edit,sort_order:Number(e.target.value)})}/></label>
 <button disabled={busy} onClick={()=>void save()}>Lưu thông tin catalog</button><small>Để trống quy cách/đóng thùng/số lượng: PDF ghi “Xác nhận khi báo giá”. Hãy lưu trước khi xuất.</small></div>}</div></>}
 </section>;
}
