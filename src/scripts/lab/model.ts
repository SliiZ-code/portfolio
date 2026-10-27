import { pixelateInto } from '../pixel/preview';

const WIDTH = 320;
const HEIGHT = 200;

/**
 * Mounts a 3D model as pixelated 3D in `box`, once the box is on screen. three.js is only loaded
 * at that point, so the board and the other pages never pay for it.
 */
export function initPixelModel(box: HTMLElement): void {
  const src = box.dataset.src;
  if (!src) return;
  const observer = new IntersectionObserver(async ([entry]) => {
    if (!entry?.isIntersecting) return;
    observer.disconnect();
    try {
      await mount(box, src);
    } catch {
      box.dataset.state = 'error';
    }
  });
  observer.observe(box);
}

async function mount(box: HTMLElement, src: string): Promise<void> {
  const canvas = box.querySelector<HTMLCanvasElement>('canvas.pix');
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !ctx) throw new Error('no canvas');
  const [THREE, { GLTFLoader }, { OrbitControls }] = await Promise.all([
    import('three'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/controls/OrbitControls.js'),
  ]);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // the model is lit on a white background at 320×200; the quantiser turns that into the theme's inks
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(2, 3, 2);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, WIDTH / HEIGHT, 0.01, 100);
  camera.position.set(0, 2.6, 2.2);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, canvas);
  controls.enableZoom = false;
  controls.enablePan = false;
  // OrbitControls sets touch-action: none; let a vertical swipe scroll the page, horizontal drag rotates
  canvas.style.touchAction = 'pan-y';
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 5;

  const gltf = await new GLTFLoader().loadAsync(src);
  const model = gltf.scene;
  // lay the board flat: its thinnest side becomes the vertical axis
  const flat = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  if (flat.z < flat.y && flat.z <= flat.x) model.rotation.x = -Math.PI / 2;
  else if (flat.x < flat.y && flat.x < flat.z) model.rotation.z = Math.PI / 2;
  model.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.setScalar(1.5 / Math.max(size.x, size.y, size.z));
  model.updateMatrixWorld(true);
  model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
  scene.add(model);

  const paint = () => {
    renderer.render(scene, camera);
    pixelateInto(canvas, ctx, renderer.domElement, WIDTH, HEIGHT);
  };
  const render = () => {
    controls.update();
    paint();
  };

  let visible = true;
  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
  }).observe(box);

  document.addEventListener('themechange', paint);
  render();
  box.dataset.state = 'ready';
  if (reduced) {
    // still, unless dragged. `change` fires from inside controls.update(), so redraw only:
    // calling render() here would re-enter update() and overflow the stack
    controls.addEventListener('change', paint);
    return;
  }
  const loop = () => {
    requestAnimationFrame(loop);
    if (visible) render();
  };
  loop();
}
