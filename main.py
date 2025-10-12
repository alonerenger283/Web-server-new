from flask import Flask, render_template_string, request, redirect, jsonify
import threading
import time
import requests

app = Flask(__name__)

# ----------------- GLOBALS -----------------
start_time = time.time()
headers = {
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.76 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
    'referer': 'www.google.com'
}

tasks = {}  # task_id : {thread_id, messages, tokens, interval, hater, status, thread, logs, id}
users = {"admin": "admin123"}  # Hardcoded login

# ----------------- HTML TEMPLATES -----------------
LOGIN_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Login</title>
<style>
body{display:flex;justify-content:center;align-items:center;height:100vh;background:#222;color:white;font-family:sans-serif;}
form{display:flex;flex-direction:column;gap:10px;width:300px;}
input,button{padding:10px;border-radius:8px;border:none;font-size:1rem;}
button{background:linear-gradient(90deg,#ff0000,#800080);color:white;cursor:pointer;}
.message{color:red;font-weight:bold;}
</style>
</head>
<body>
<form method="POST">
<h2>Login</h2>
<input type="text" name="username" placeholder="Username" required>
<input type="password" name="password" placeholder="Password" required>
<button type="submit">Login</button>
{% if message %}<p class="message">{{message}}</p>{% endif %}
</form>
</body>
</html>
"""

DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>0FLIN3 C0NV0 S3RV3R</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&display=swap');

body {
  font-family: 'Orbitron', sans-serif;
  margin:0;
  padding:0;
  background:#0d0d0d;
  color:#fff;
}

header{
  text-align:center;
  padding:20px;
  font-size:2rem;
  color:#ff00ff;
  text-shadow: 0 0 10px #ff00ff, 0 0 20px #ff00ff;
  background:#111;
}

.container{
  display:flex;
  flex-direction:column;
  gap:30px;
  padding:20px;
}

.panel{
  width:100%;
  background: linear-gradient(145deg, #1a1a1a, #2c2c2c);
  border-radius:20px;
  padding:25px;
  box-shadow: 0 0 20px #ff00ff, 0 0 40px #8000ff;
  transition: transform 0.2s;
}

.panel:hover{
  transform: scale(1.02);
}

.panel h3{
  font-size:1.8rem;
  color:#ff00ff;
  text-shadow: 0 0 5px #ff00ff, 0 0 10px #8000ff;
  margin-bottom:15px;
}

input, button, select{
  padding:15px;
  margin:10px 0;
  width:100%;
  border-radius:15px;
  border:none;
  font-size:1.1rem;
  background:#222;
  color:#fff;
  box-shadow: inset 0 0 5px #ff00ff;
}

button{
  cursor:pointer;
  background: linear-gradient(90deg,#ff0000,#8000ff);
  color:white;
  font-weight:bold;
  box-shadow: 0 0 10px #ff00ff, 0 0 20px #8000ff;
  transition: 0.2s;
}

button:hover{
  transform: scale(1.05);
  box-shadow: 0 0 20px #ff00ff, 0 0 40px #8000ff;
}

/* ✅ Hacker Green Logs Style */
#logs{
  height:250px;
  overflow-y:auto;
  background:#000;
  padding:10px;
  border-radius:15px;
  box-shadow: inset 0 0 10px #00ff00;
  font-size:0.95rem;
  line-height:1.3rem;
  color:#00ff00;  /* <-- Logs text now green */
  font-family: "Courier New", monospace;
}

@media (max-width:768px){
  header{font-size:1.5rem;}
  .panel h3{font-size:1.4rem;}
  input, button, select{font-size:1rem;padding:12px;}
  #logs{font-size:0.85rem;}
}
</style>
</head>
<body>
<header>Created By Anaya iinxiide</header>
<div class="container">

  <div class="panel">
    <h3>Start New Task</h3>
    <form id="taskForm" enctype="multipart/form-data" method="POST">
      <label>Thread/Convo ID:</label><input type="text" name="threadId" required>
      <label>Hater Name:</label><input type="text" name="kidx" required>
      <label>Interval (seconds):</label><input type="number" name="time" value="60" required>
      <label>Single Token:</label><input type="text" name="singleToken" placeholder="Or leave blank">
      <label>Or Token File:</label><input type="file" name="txtFile" accept=".txt">
      <label>Messages File:</label><input type="file" name="messagesFile" accept=".txt" required>
      <button type="submit">Start Task</button>
    </form>
    <button onclick="getHealth()">Health / Uptime</button>
    <p id="healthResult"></p>
  </div>

  <div class="panel">
    <h3>Tasks Monitor</h3>
    <select id="taskSelect"><option value="">--Select Task--</option></select>
    <div id="logs"></div>
    <button onclick="pauseTask()">Pause</button>
    <button onclick="resumeTask()">Resume</button>
    <button onclick="stopTask()">Stop</button>
  </div>

</div>

<script>
const taskForm=document.getElementById("taskForm");
taskForm.onsubmit=async function(e){
    e.preventDefault();
    let formData=new FormData(taskForm);
    await fetch("/convo",{method:"POST",body:formData});
    alert("Task Started!");
    loadTasks();
}
async function getHealth(){
    const res=await fetch("/health");
    const data=await res.json();
    document.getElementById("healthResult").innerText=`Uptime: ${data.days}d ${data.hours}h ${data.minutes}m ${data.seconds}s`;
}
async function loadTasks(){
    const res=await fetch("/tasks");
    const data=await res.json();
    const select=document.getElementById("taskSelect");
    select.innerHTML='<option value="">--Select Task--</option>';
    data.forEach(t=>{select.innerHTML+=`<option value="${t.id}">${t.thread_id} [${t.status}]</option>`;});
}
async function fetchLogs(){
    const taskId=document.getElementById("taskSelect").value;
    if(!taskId)return;
    const res=await fetch(`/task_logs/${taskId}`);
    const logs=await res.json();
    document.getElementById("logs").innerHTML=logs.map(l=>`<div>[${l.timestamp}] <span style='color:#00ff00;'>Thread:</span>${l.thread_id} <span style='color:#00ff00;'>Token:</span>${l.token} <span style='color:#00ff00;'>Msg:</span>${l.message}</div>`).join("");
}
setInterval(fetchLogs,3000);
async function pauseTask(){
    const taskId=document.getElementById("taskSelect").value;
    if(!taskId)return; await fetch(`/task/${taskId}/pause`,{method:"POST"}); loadTasks();
}
async function resumeTask(){
    const taskId=document.getElementById("taskSelect").value;
    if(!taskId)return; await fetch(`/task/${taskId}/resume`,{method:"POST"}); loadTasks();
}
async function stopTask(){
    const taskId=document.getElementById("taskSelect").value;
    if(!taskId)return; await fetch(`/task/${taskId}/stop`,{method:"POST"}); loadTasks();
}
loadTasks();
</script>
</body>
</html>
"""

# ----------------- HELPERS -----------------
def run_task(task_id):
    task = tasks.get(task_id)
    if not task: return
    num_comments = len(task["messages"])
    max_tokens = len(task["tokens"])
    interval = task["interval"]
    post_url = f'https://graph.facebook.com/v15.0/t_{task["thread_id"]}/'
    hater = task["hater"]
    i = 0
    while task["status"] != "stopped":
        if task["status"]=="paused": time.sleep(1); continue
        if num_comments==0 or max_tokens==0: task["status"]="stopped"; break
        msg_index=i%num_comments
        token_index=i%max_tokens
        access_token=task["tokens"][token_index]
        message=task["messages"][msg_index].strip()
        try:
            requests.post(post_url,json={"access_token":access_token,"message":f"{hater} {message}"},headers=headers,timeout=10)
            task["logs"].append({"timestamp":time.strftime("%Y-%m-%d %H:%M:%S"),"message":message,"thread_id":task["thread_id"],"token":access_token})
            print(f"[+] Task {task_id} -> {hater} {message}")
        except Exception as e: print(f"Error in task {task_id}: {e}")
        i+=1
        time.sleep(interval)
    print(f"[x] Task {task_id} stopped")

# ----------------- ROUTES -----------------
@app.route("/", methods=["GET","POST"])
def login():
    message=None
    if request.method=="POST":
        u=request.form.get("username","").strip()
        p=request.form.get("password","")
        if u in users and users[u]==p: return redirect("/dashboard")
        else: message="❌ Invalid Username or Password!"
    return render_template_string(LOGIN_HTML,message=message)

@app.route("/dashboard")
def dashboard():
    return render_template_string(DASHBOARD_HTML)

@app.route("/convo",methods=["POST"])
def convo():
    thread_id=request.form.get("threadId","").strip()
    hater=request.form.get("kidx","").strip()
    try: interval=int(request.form.get("time","60")); interval=max(interval,1)
    except: interval=60
    tokens=[]
    single_token=request.form.get("singleToken","").strip()
    if single_token: tokens=[single_token]
    else:
        f=request.files.get("txtFile")
        if f and f.filename: tokens=[t.strip() for t in f.read().decode(errors="ignore").splitlines() if t.strip()]
    msg_file=request.files.get("messagesFile")
    messages=[]
    if msg_file and msg_file.filename: messages=[m.strip() for m in msg_file.read().decode(errors="ignore").splitlines() if m.strip()]
    if not (thread_id and hater and messages and tokens): return redirect("/dashboard")
    task_id=str(int(time.time()*1000))
    t=threading.Thread(target=run_task,args=(task_id,),daemon=True)
    tasks[task_id]={"thread_id":thread_id,"messages":messages,"tokens":tokens,"interval":interval,"hater":hater,"status":"running","thread":t,"id":task_id,"logs":[]}
    t.start()
    return redirect("/dashboard")

@app.route("/tasks")
def get_tasks():
    return jsonify([{"id":t["id"],"thread_id":t["thread_id"],"status":t["status"]} for t in tasks.values()])

@app.route("/task/<task_id>/<action>",methods=["POST"])
def control_task(task_id,action):
    if task_id in tasks:
        if action=="pause": tasks[task_id]["status"]="paused"
        elif action=="resume": tasks[task_id]["status"]="running"
        elif action=="stop": tasks[task_id]["status"]="stopped"
    return "",204

@app.route("/task_logs/<task_id>")
def task_logs(task_id):
    return jsonify(tasks.get(task_id,{}).get("logs",[]))

@app.route("/health")
def health():
    uptime=int(time.time()-start_time)
    days=uptime//86400; hours=(uptime%86400)//3600; minutes=(uptime%3600)//60; seconds=uptime%60
    return jsonify({"days":days,"hours":hours,"minutes":minutes,"seconds":seconds})

# ----------------- RUN -----------------
if __name__=="__main__":
    app.run(host="0.0.0.0",port=5000,debug=True)
