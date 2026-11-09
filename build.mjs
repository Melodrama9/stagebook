import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
let html=await readFile('index.html','utf8');
for(const file of ['style.css','app.js','config.js']){
  const content=await readFile(file);
  const hash=createHash('sha256').update(content).digest('hex').slice(0,12);
  const asset=file.replace(/\.(css|js)$/,`.${hash}.$1`);
  await writeFile(`dist/${asset}`,content);
  html=html.replaceAll(`"${file}"`,`"${asset}"`);
  // Keep unversioned files available for previously opened pages.
  await writeFile(`dist/${file}`,content);
}
await writeFile('dist/index.html',html);
