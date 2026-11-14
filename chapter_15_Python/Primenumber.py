n = 2

while n <= 100:
    i = 2
    prime = True

    while i < n:
        if n % i == 0:
            prime = False
            break
        i += 1

    if prime:
        print(n, end=" ")

    n += 1