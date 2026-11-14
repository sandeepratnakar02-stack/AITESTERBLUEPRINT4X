# Print a right triangle pattern using stars. For input n, print n rows where row i has i stars.

import sys
n = int(sys.stdin.readline())

for i in range(1, n+1):
    for j in range(i):
       print("*", end="")            
    print()



