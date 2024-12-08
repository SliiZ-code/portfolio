import * as THREE from 'three';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

let raycaster;
let INTERSECTED;
const pointer = new THREE.Vector2();

const container = document.getElementById('body');

document.addEventListener('mousemove', onPointerMove);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const pmremGenerator = new THREE.PMREMGenerator(renderer);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x161616);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 100);
camera.position.set(0, 0, 8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.update();
controls.enableZoom = true;
controls.enablePan = false;
controls.enableDamping = true;

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);
loader.load('public/shape.glb', function (gltf) {

    const model = gltf.scene;
    model.scale.set(0.001, 0.001, 0.001);

    model.traverse((child) => {
        if (child.isMesh) {
            child.position.set(0, 0, 0);
            child.material = new THREE.MeshPhysicalMaterial({
                color: 0x00f4ff,
                iridescence: 1.0,
                metalness: 0.5,
                roughness: 0.1,
                envMapIntensity: 1,
                emissive: 0xff00cb,
                emissiveIntensity: 0.3,
                clearcoat: 1,
                clearcoatRoughness: 0.1,
                reflectivity: 1,
            });
            child.layers.enable(1);
            INTERSECTED = child;
        }
    });
    scene.add(model);

    renderer.setAnimationLoop(animate);

}, undefined, function (e) {

    console.error(e);

});

loader.load('public/gameboy.glb', function (gltf) {

    const model = gltf.scene;
    model.position.set(-2, 0, -5);
    model.rotation.set(0, 0, 0);
    model.scale.set(0.04, 0.04, 0.04);

    model.traverse((child) => {
        if (child.isMesh) {
            child.position.set(-2, 0, -5);
            child.material = new THREE.MeshPhysicalMaterial({
                color: 0xffd966,
                iridescence: 1.0,
                metalness: 0.5,
                roughness: 0.1,
                envMapIntensity: 1,
                emissive: 0x8fce00,
                emissiveIntensity: 0.3,
                clearcoat: 1,
                clearcoatRoughness: 0.1,
                reflectivity: 1,
            });
            child.layers.enable(1);
        }
    });

    scene.add(model);
    renderer.setAnimationLoop(animate);

}, undefined, function (e) {

    console.error(e);

});

loader.load('public/iphone.glb', function (gltf) {

    const model = gltf.scene;
    model.position.set(-7, 0.4, 0);
    model.rotation.set(0, -1.7, 0);
    model.scale.set(10, 10, 10);

    model.traverse((child) => {
        if (child.isMesh) {
            child.position.set(-7, 0.4, 0);
            child.material = new THREE.MeshPhysicalMaterial({
                color: 0x979797,
                iridescence: 1.0,
                metalness: 0.5,
                roughness: 0.1,
                envMapIntensity: 1,
                emissive: 0xa22e39,
                emissiveIntensity: 0.3,
                clearcoat: 1,
                clearcoatRoughness: 0.1,
                reflectivity: 1,
            });
            child.layers.enable(1);
        }
    });

    scene.add(model);
    renderer.setAnimationLoop(animate);

}, undefined, function (e) {

    console.error(e);

});

loader.load('public/arduino.glb', function (gltf) {

    const model = gltf.scene;
    model.position.set(-5, 0, 16);
    model.rotation.set(0, 3, 0);
    model.scale.set(1, 1, 1);

    model.traverse((child) => {
        if (child.isMesh) {
            child.position.set(-2, 0, 8);
            child.material = new THREE.MeshPhysicalMaterial({
                color: 0x5672A1,
                iridescence: 1.0,
                metalness: 0.5,
                roughness: 0.1,
                envMapIntensity: 1,
                emissive: 0x1C6DF3,
                emissiveIntensity: 0.3,
                clearcoat: 1,
                clearcoatRoughness: 0.1,
                reflectivity: 1,
            });
            child.layers.enable(1);
        }
    });

    scene.add(model);
    renderer.setAnimationLoop(animate);

}, undefined, function (e) {

    console.error(e);

});

loader.load('public/computer.glb', function (gltf) {

    const model = gltf.scene;
    model.position.set(14, 0, 2);
    model.rotation.set(0, 3.2, 0);
    model.scale.set(0.7, 0.7, 0.7);

    model.traverse((child) => {
        if (child.isMesh) {
            child.position.set(9.5, 1, 1);
            child.material = new THREE.MeshPhysicalMaterial({
                color: 0xD6EADF,
                iridescence: 1.0,
                metalness: 0.5,
                roughness: 0.1,
                envMapIntensity: 1,
                emissive: 0x65dc31,
                emissiveIntensity: 0.3,
                clearcoat: 1,
                clearcoatRoughness: 0.1,
                reflectivity: 1,
            });
            child.layers.enable(1);
        }
    });

    scene.add(model);
    renderer.setAnimationLoop(animate);

}, undefined, function (e) {

    console.error(e);

});

const particlesCount = 50000;
const positions = new Float32Array(particlesCount * 3);

for (let i = 0; i < particlesCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 100;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 100;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

const material = new THREE.PointsMaterial({ size: 0.01 });
const particleSystem = new THREE.Points(geometry, material);
scene.add(particleSystem);

const videoConway = document.getElementById('videoConway');
videoConway.play();
const videoConwayTexture = new THREE.VideoTexture(videoConway);
videoConwayTexture.needsUpdate = true;

const videoConwayMaterial = new THREE.MeshBasicMaterial({ map: videoConwayTexture, side: THREE.DoubleSide });
const videoConwayGeometry = new THREE.PlaneGeometry(0.5, 0.5); // Adjust size as needed
var mesh = new THREE.Mesh(videoConwayGeometry, videoConwayMaterial);
mesh.position.set(-2.07, 0.87, -5.06);
mesh.rotation.set(0, 0, 0);
scene.add(mesh);

const videoBlink = document.getElementById('videoBlink');
videoBlink.play();
const videoBlinkTexture = new THREE.VideoTexture(videoBlink);
videoBlinkTexture.needsUpdate = true;

const videoBlinkMaterial = new THREE.MeshBasicMaterial({ map: videoBlinkTexture, side: THREE.DoubleSide });
const videoBlinkGeometry = new THREE.PlaneGeometry(2.3, 1); // Adjust size as needed
var mesh = new THREE.Mesh(videoBlinkGeometry, videoBlinkMaterial);
mesh.position.set(8.9, 1.74, 1.63);
mesh.rotation.set(0, -1.5, 0);
scene.add(mesh);

const textureLoader = new THREE.TextureLoader();
const texture = textureLoader.load('public/thrive.jpg', () => {
    // Create a plane geometry and apply the texture
    const geometry = new THREE.PlaneGeometry(0.75, 1.5);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const plane = new THREE.Mesh(geometry, material);
    plane.position.set(-6.91, 0.4, -0.33)
    plane.rotation.set(0, 1.45, 0)
    // Add the plane to the scene
    scene.add(plane);
})

raycaster = new THREE.Raycaster();
raycaster.layers.set(1);
window.onresize = function () {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);

};

function onPointerMove(event) {

    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = - (event.clientY / window.innerHeight) * 2 + 1;

}

const map = new Map([
    ["Icosphere", "infos"],
    ["Object_9", "conway"],
    ["Object_4", "conway"],
    ["defaultMaterial", "thrive"],
    ["node_id293_Material_258_0", "station"],
    ["keyboard_Material001_0", "blink"]
])

function showText(id) {
    for (const [key, value] of map) {
        var text = document.getElementById(value);
        if (text) {
            text.style.zIndex = -1;
        }
    }
    var text = document.getElementById(id);
    if (text) {
        text.style.zIndex = 100;
    }
}

function animate() {

    controls.update();
    renderer.render(scene, camera);


}


document.addEventListener('mousedown', function (event) {
    raycaster.setFromCamera(pointer, camera)

    const intersects = raycaster.intersectObjects(scene.children, true);
    if (intersects.length > 0) {
        console.log(intersects[0].object)
        if (INTERSECTED != intersects[0].object) {
            INTERSECTED = intersects[0].object;
            showText(map.get(INTERSECTED.name));
            const targetPosition = INTERSECTED.position;
            camera.position.set(targetPosition.x * 0.1 + 5, targetPosition.y, targetPosition.z * 0.1 + 5)
            controls.target.set(targetPosition.x, targetPosition.y, targetPosition.z);
            controls.update();

        }

    }
});