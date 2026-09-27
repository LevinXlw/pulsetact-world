import * as T from 'three';

export function random(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}

export function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.anisotropy = 8;
  return texture;
}

export function limestoneTexture() {
  return canvasTexture(512, 512, ctx => {
    const rng = random(1931); ctx.fillStyle = '#cfcac0'; ctx.fillRect(0, 0, 512, 512);
    const pixels = ctx.getImageData(0, 0, 512, 512);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const grain = (rng() - .5) * 16;
      pixels.data[i] += grain; pixels.data[i + 1] += grain; pixels.data[i + 2] += grain;
    }
    ctx.putImageData(pixels, 0, 0);
  });
}

export function windowTexture(style = 0) {
  return canvasTexture(128, 256, ctx => {
    const gradient = ctx.createLinearGradient(0, 0, 128, 256);
    gradient.addColorStop(0, '#acb9bf'); gradient.addColorStop(.48, '#8f9da1'); gradient.addColorStop(.53, '#728083'); gradient.addColorStop(1, '#576260');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 256);
    const blind = [5, 51, 103, 166][style % 4];
    ctx.fillStyle = style === 3 ? '#aaa99e' : '#bbc1ba'; ctx.fillRect(0, 0, 128, blind);
    for (let y = 0; y < blind; y += 5) { ctx.fillStyle = '#989e99'; ctx.fillRect(0, y, 128, 1); }
    ctx.fillStyle = 'rgba(218,218,204,.25)'; ctx.fillRect(79, 60, 2, 173);
    ctx.fillStyle = 'rgba(35,41,39,.16)'; ctx.fillRect(13, 125, 32, 126); ctx.fillRect(91, 186, 20, 66);
    ctx.fillStyle = '#4b5352'; ctx.fillRect(0, 139, 128, 3);
  });
}

export function cityFacadeTexture(style: number, emission = false) {
  return canvasTexture(256, 512, ctx => {
    const rng = random(501 + style), stone = ['#aaa294', '#8f8172', '#b1a89a', '#777c7a', '#9e9990', '#8b6f5b'][style % 6];
    ctx.fillStyle = emission ? '#000000' : stone; ctx.fillRect(0, 0, 256, 512);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {
      const light = rng() > .72, v = 48 + rng() * 44;
      ctx.fillStyle = emission ? light ? '#c9a56c' : '#000000' : `rgb(${v},${v + 7},${v + 9})`;
      ctx.fillRect(x * 32 + 8, y * 32 + 6, 17, 21);
      if (!emission) {
        ctx.fillStyle = '#b2b0a3'; ctx.fillRect(x * 32 + 8, y * 32 + 15, 17, 1);
        ctx.fillStyle = '#595e5c'; ctx.fillRect(x * 32 + 16, y * 32 + 6, 1, 21);
        ctx.fillStyle = 'rgba(30,28,24,.2)'; ctx.fillRect(x * 32 + 6, y * 32 + 28, 21, 1);
      }
    }
  });
}
