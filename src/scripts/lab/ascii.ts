const CHARSET = ' .:-+*=%@#';

/**
 * Mounts a 3D model as live ASCII in `box`, once the box is on screen. three.js is only loaded
 * at that point, so the board and the other pages never pay for it.
 */
export function initAsciiModel(box: HTMLElement): void {
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
  const [THREE, { AsciiEffect }, { GLTFLoader }, { OrbitControls }] = await Promise.all([
    import('three'),
    import('three/addons/effects/AsciiEffect.js'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/controls/OrbitControls.js'),
  ]);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const width = () => Math.max(1, box.clientWidth);
  const height = () => Math.max(1, box.clientHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, width() / height(), 0.01, 100);
  camera.position.set(0, 1.7, 2.6);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x111111, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(2, 3, 1.5);
  scene.add(sun);

  // the lit model is bright on a black background; inverted, that background maps to spaces and
  // the model to dense characters, so the theme only has to supply the ink and the paper
  const renderer = new THREE.WebGLRenderer();
  const effect = new AsciiEffect(renderer, CHARSET, { invert: true });
  effect.setSize(width(), height());
  box.prepend(effect.domElement);

  const controls = new OrbitControls(camera, effect.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 2;

  const gltf = await new GLTFLoader().loadAsync(src);
  const model = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  model.scale.setScalar(1.9 / Math.max(size.x, size.y, size.z));
  model.position.sub(bounds.getCenter(new THREE.Vector3()).multiplyScalar(model.scale.x));
  scene.add(model);

  const render = () => {
    controls.update();
    effect.render(scene, camera);
  };

  const applyTheme = () => {
    const style = getComputedStyle(document.documentElement);
    effect.domElement.style.color = style.getPropertyValue('--ink').trim();
    effect.domElement.style.backgroundColor = style.getPropertyValue('--paper').trim();
  };
  applyTheme();
  document.addEventListener('themechange', () => {
    applyTheme();
    render();
  });

  new ResizeObserver(() => {
    camera.aspect = width() / height();
    camera.updateProjectionMatrix();
    effect.setSize(width(), height());
    render();
  }).observe(box);

  let visible = true;
  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
  }).observe(box);

  render();
  box.dataset.state = 'ready';
  if (reduced) {
    // still, unless dragged
    controls.addEventListener('change', render);
    return;
  }
  const loop = () => {
    requestAnimationFrame(loop);
    if (visible) render();
  };
  loop();
}
