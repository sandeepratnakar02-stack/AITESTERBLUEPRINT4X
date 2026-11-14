import sys
n = int(sys.stdin.readline())

for i in range(1, n+1):
    for j in range(n+1-i):
        print("*", end="")
    for j in range(n-i):
        print("*", end="")
    print()
    for j in range(i):
        print(" ", end="")


