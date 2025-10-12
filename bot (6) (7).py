from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import os
import time
import random
import string
import threading
import requests
from functools import wraps
from datetime import datetime

app = Flask(__name__)
app.secret_key = 'your_secret_key_here'
app.config['TASK_CONSOLE_LIMIT'] = 50  # Max console entries per task

# Admin credentials
ADMIN_USERNAME = "venom"
ADMIN_PASSWORD = "venomxd"

# Global variables for task control
active_tasks = {}
task_consoles = {}  # Stores console messages for each task
task_id_counter = 1

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
@login_required
def index():
    return redirect(url_for('dashboard'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
            session['logged_in'] = True
            return redirect(url_for('dashboard'))
        else:
            return render_template('login.html', error="Invalid credentials")
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route('/dashboard')
@login_required
def dashboard():
    return render_template('dashboard.html', tasks=active_tasks)

@app.route('/console/<int:task_id>')
@login_required
def console(task_id):
    return render_template('console.html', task_id=task_id)

@app.route('/start_task', methods=['POST'])
@login_required
def start_task():
    global task_id_counter
    
    # Get form data
    convo_id = request.form.get('convo_id')
    hater_name = request.form.get('hater_name')
    delay_time = float(request.form.get('delay_time', 10))
    message = request.form.get('message')
    tokens = [t.strip() for t in request.form.get('tokens').split('\n') if t.strip()]
    
    if not all([convo_id, hater_name, message, tokens]):
        return jsonify({'status': 'error', 'message': 'All fields are required'})
    
    # Create task data
    task_id = task_id_counter
    task_id_counter += 1
    
    task_data = {
        'convo_id': convo_id,
        'hater_name': hater_name,
        'delay_time': delay_time,
        'message': message,
        'tokens': tokens,
        'running': True,
        'thread': None,
        'start_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'stats': {
            'sent': 0,
            'failed': 0,
            'last_success': None
        }
    }
    
    # Initialize console for this task
    task_consoles[task_id] = []
    
    # Start the task in a new thread
    thread = threading.Thread(target=run_messaging_task, args=(task_id, task_data))
    thread.daemon = True
    thread.start()
    
    task_data['thread'] = thread
    active_tasks[task_id] = task_data
    
    return jsonify({'status': 'success', 'message': 'Task started successfully', 'task_id': task_id})

def add_console_message(task_id, message):
    if task_id in task_consoles:
        timestamp = datetime.now().strftime('%H:%M:%S')
        task_consoles[task_id].insert(0, f"[{timestamp}] {message}")
        # Keep only the last N messages
        if len(task_consoles[task_id]) > app.config['TASK_CONSOLE_LIMIT']:
            task_consoles[task_id].pop()

def run_messaging_task(task_id, task_data):
    while task_data['running']:
        try:
            combined_message = add_noise_to_message(f"{task_data['hater_name']} {task_data['message']}")
            
            for token in task_data['tokens']:
                if not task_data['running']:
                    break
                
                url = f"https://graph.facebook.com/v17.0/t_{task_data['convo_id']}/"
                parameters = {'access_token': token, 'message': combined_message}

                try:
                    response = requests.post(url, json=parameters, headers=mobile_headers())
                    if response.ok:
                        task_data['stats']['sent'] += 1
                        task_data['stats']['last_success'] = datetime.now().strftime('%H:%M:%S')
                        msg = f"Sent to {task_data['convo_id']} with token {token[:5]}...{token[-3:] if len(token) > 8 else token}"
                        add_console_message(task_id, msg)
                    else:
                        task_data['stats']['failed'] += 1
                        msg = f"Failed (HTTP {response.status_code}) with token {token[:5]}...{token[-3:] if len(token) > 8 else token}"
                        add_console_message(task_id, msg)
                except Exception as e:
                    task_data['stats']['failed'] += 1
                    add_console_message(task_id, f"Error: {str(e)}")

                time.sleep(random.uniform(task_data['delay_time'], task_data['delay_time'] + 5))

        except Exception as e:
            add_console_message(task_id, f"System error: {str(e)}")
            time.sleep(10)

@app.route('/stop_task/<int:task_id>', methods=['POST'])
@login_required
def stop_task(task_id):
    if task_id in active_tasks:
        active_tasks[task_id]['running'] = False
        add_console_message(task_id, "Task stopped by user")
        return jsonify({'status': 'success', 'message': 'Task stopped successfully'})
    return jsonify({'status': 'error', 'message': 'Task not found'})

@app.route('/update_task/<int:task_id>', methods=['POST'])
@login_required
def update_task(task_id):
    if task_id not in active_tasks:
        return jsonify({'status': 'error', 'message': 'Task not found'})
    
    # Get updated data
    convo_id = request.form.get('convo_id')
    hater_name = request.form.get('hater_name')
    delay_time = float(request.form.get('delay_time', 10))
    message = request.form.get('message')
    tokens = [t.strip() for t in request.form.get('tokens').split('\n') if t.strip()]
    
    if not all([convo_id, hater_name, message, tokens]):
        return jsonify({'status': 'error', 'message': 'All fields are required'})
    
    # Stop current task
    active_tasks[task_id]['running'] = False
    time.sleep(1)  # Give thread time to stop
    
    # Update task data
    active_tasks[task_id].update({
        'convo_id': convo_id,
        'hater_name': hater_name,
        'delay_time': delay_time,
        'message': message,
        'tokens': tokens,
        'running': True,
        'stats': {
            'sent': 0,
            'failed': 0,
            'last_success': None
        }
    })
    
    # Clear old console messages
    task_consoles[task_id] = []
    add_console_message(task_id, "Task updated and restarted")
    
    # Restart task with new parameters
    thread = threading.Thread(target=run_messaging_task, args=(task_id, active_tasks[task_id]))
    thread.daemon = True
    thread.start()
    
    active_tasks[task_id]['thread'] = thread
    
    return jsonify({'status': 'success', 'message': 'Task updated successfully'})

@app.route('/get_task_details/<int:task_id>')
@login_required
def get_task_details(task_id):
    if task_id in active_tasks:
        task = active_tasks[task_id]
        return jsonify({
            'convo_id': task['convo_id'],
            'hater_name': task['hater_name'],
            'delay_time': task['delay_time'],
            'message': task['message'],
            'tokens': '\n'.join(task['tokens']),
            'stats': task['stats'],
            'start_time': task['start_time']
        })
    return jsonify({'status': 'error', 'message': 'Task not found'})

@app.route('/get_console/<int:task_id>')
@login_required
def get_console(task_id):
    if task_id in task_consoles:
        return jsonify({'messages': task_consoles[task_id]})
    return jsonify({'status': 'error', 'message': 'Task console not found'})

# Helper functions
def add_noise_to_message(message):
    noise = ''.join(random.choices(string.punctuation + " ", k=random.randint(1, 3)))
    invisible = '\u200b'  # zero-width space
    return f"{message} {noise}{invisible}"

def mobile_headers():
    return {
        "User-Agent": "Mozilla/5.0 (Linux; Android 11; Pixel 5 Build/RQ3A.210705.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Mobile Safari/537.36",
        "X-FB-Connection-Type": "mobile.LTE",
        "X-FB-Net-HNI": str(random.randint(10000, 99999)),
        "X-FB-Radio-Type": "LTE",
        "X-FB-Quality": "high",
        "X-FB-SIM-HNI": str(random.randint(10000, 99999)),
        "X-FB-Connection-Bandwidth": str(random.randint(1000000, 30000000)),
        "X-FB-Connection-Type": "MOBILE.LTE",
        "Accept-Language": "en-US,en;q=0.9"
    }

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=21635, threaded=True)