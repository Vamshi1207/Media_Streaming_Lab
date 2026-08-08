import socket

ports = [7100, 7200, 7201, 7300, 7400, 7500, 7600, 7700, 7800, 8096]
in_use = []

for port in ports:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('0.0.0.0', port))
        except OSError:
            in_use.append(port)

print("Ports in use:", in_use)
