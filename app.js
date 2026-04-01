import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { SUBTRACTION, Brush, Evaluator } from 'three-bvh-csg';


let camera, scene, renderer;
let controller, reticle;

// Spazio di lavoro booleano
let evaluator;
let roomBrush, doorBrush, resultMesh;

// Parametri dimensionali (iniziali in metri)
let params = { width: 2, height: 1, depth: 2, doorPos: 10 };
// Dimensioni fisse della porta
const doorDims = { w: 0.8, h: 2.0, d: 0.5 }; // d è lo spessore del taglio

let hitTestSource = null;
let hitTestSourceRequested = false;
let scenePlaced = false;

init();
animate();

function init() {
    const container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3);
    scene.add(light);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    const arButton = ARButton.createButton(renderer, { 
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.body }
    });
    document.body.appendChild(arButton);

    // --- SETUP CSG ---
    evaluator = new Evaluator();
    
    // 1. Il Brush della Stanza (Verde)
    // Usiamo materiali trasparenti per vedere il taglierino rosso dentro
    const roomMat = new THREE.MeshPhongMaterial({ color: 0x44aa88, opacity: 0.6, transparent: true, side: THREE.DoubleSide });
    roomBrush = new Brush(new THREE.BoxGeometry(1, 1, 1), roomMat);
    // TRUCCO PIVOT: Spostiamo la geometria in su di 0.5 (metà altezza)
    // Così l'origine (0,0,0) del Brush corrisponde alla faccia inferiore.
    roomBrush.geometry.translate(0, 0.5, 0); 
    roomBrush.visible = false;
    scene.add(roomBrush);

    // 2. Il Brush della Porta (Rosso - Il "Taglierino")
    const doorMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
    doorBrush = new Brush(new THREE.BoxGeometry(doorDims.w, doorDims.h, doorDims.d), doorMat);
    // Anche per la porta, pivot alla base
    doorBrush.geometry.translate(0, 0.5, 0);
    doorBrush.visible = false;
    scene.add(doorBrush);

    // 3. La Mesh del Risultato (inizialmente vuota, userà il materiale della stanza)
    resultMesh = new THREE.Mesh(new THREE.BufferGeometry(), roomMat);
    resultMesh.visible = false;
    scene.add(resultMesh);

    // --- SETUP MIRINO ---
    const reticleGeometry = new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
    reticle = new THREE.Mesh(reticleGeometry, new THREE.MeshBasicMaterial({ color: 0x00aaff }));
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    setupSliders();
    
    // Aggiornamento iniziale delle forme basato sui parametri di default
    updateShapes(); 

    window.addEventListener('resize', onWindowResize);
}

// Aggiorna le dimensioni dei Brush e la posizione della porta, senza tagliare
function updateShapes() {
    // Aggiorna la stanza (pivot alla base funzionerà grazie al translate(0, 0.5, 0) fatto nell'init)
    roomBrush.scale.set(params.width, params.height, params.depth);
    
    // Calcola la posizione della porta lungo il perimetro
    updateDoorPosition();
}

// Calcola dove mettere il taglierino rosso basato sullo slider 0-100%
function updateDoorPosition() {
    const w = params.width;
    const d = params.depth;
    const perimetro = (w + d) * 2;
    // Distanza percorsa lungo il perimetro basata sullo slider
    let dist = (params.doorPos / 100) * perimetro;

    let x, z, angle;

    // Logica per far girare l'oggetto sui 4 lati
    if (dist <= w) { 
        // Lato Frontale (X corre, Z fisso avanti)
        x = dist - w/2;
        z = d/2;
        angle = 0;
    } else if (dist <= w + d) { 
        // Lato Destro (X fisso destra, Z corre indietro)
        x = w/2;
        z = d/2 - (dist - w);
        angle = Math.PI / 2;
    } else if (dist <= 2*w + d) { 
        // Lato Posteriore (X corre indietro, Z fisso dietro)
        x = w/2 - (dist - (w+d));
        z = -d/2;
        angle = Math.PI;
    } else { 
        // Lato Sinistro (X fisso sinistra, Z corre avanti)
        x = -w/2;
        z = -d/2 + (dist - (2*w+d));
        angle = -Math.PI / 2;
    }

    doorBrush.position.set(x, 0, z);
    doorBrush.rotation.y = angle;
}

// Esegue l'operazione booleana vera e propria
function performCut() {
    if (!scenePlaced) return;

    console.log("Eseguo il taglio booleano...");
    
    // Applichiamo le trasformazioni (scale/position) alle geometrie prima del calcolo
    roomBrush.updateMatrixWorld(true);
    doorBrush.updateMatrixWorld(true);

    // Eseguiamo la sottrazione: Stanza - Porta
    // Il risultato viene scritto direttamente nella geometry di resultMesh
    evaluator.evaluate(roomBrush, doorBrush, SUBTRACTION, resultMesh);
    
    // Ora mostriamo il risultato tagliato e nascondiamo la stanza intera
    resultMesh.visible = true;
    roomBrush.visible = false;
    
    // Aggiorniamo la resultMesh affinché sia nella stessa posizione della stanza
    resultMesh.position.copy(roomBrush.position);
    resultMesh.rotation.copy(roomBrush.rotation);
}

function setupSliders() {
    const inputs = ['width', 'height', 'depth', 'doorPos'];
    inputs.forEach(id => {
        document.getElementById(id).addEventListener('input', (e) => {
            params[id] = parseFloat(e.target.value);
            updateShapes();
            
            // Se abbiamo già tagliato, dobbiamo ricalcolare il taglio se cambiamo le dimensioni della stanza
            // (Nota: per performance, in un'app reale si eviterebbe di ricalcolare CSG durante lo slide,
            // ma solo al rilascio del mouse. Qui lo facciamo per semplicità).
            if(resultMesh.visible && id !== 'doorPos') {
                performCut();
            }
        });
    });

    document.getElementById('intersectBtn').addEventListener('click', performCut);
}

function onSelect() {
    if (reticle.visible) {
        // Piazziamo l'origine del sistema booleano sul pavimento
        const pos = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
        
        roomBrush.position.copy(pos);
        // Assicuriamoci che resultMesh parta dalla stessa posizione
        resultMesh.position.copy(pos); 

        // Mostriamo i Brush per la manipolazione iniziale
        roomBrush.visible = true;
        doorBrush.visible = true;
        
        // Nascondiamo il vecchio risultato se stavamo riposizionando
        resultMesh.visible = false; 
        
        scenePlaced = true;
        reticle.visible = false; // Nascondi mirino dopo il piazzamento
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
    if (frame && !scenePlaced) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false) {
            session.requestReferenceSpace('viewer').then(function (referenceSpace) {
                session.requestHitTestSource({ space: referenceSpace }).then(function (source) {
                    hitTestSource = source;
                });
            });
            session.requestReferenceSpace('local').then(function (space) {
                 // referenceSpace = space; // Non necessario sovrascrivere qui
            });
            hitTestSourceRequested = true;
        }

        if (hitTestSource) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];
                reticle.visible = true;
                reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
            } else {
                reticle.visible = false;
            }
        }
    }
    renderer.render(scene, camera);
}